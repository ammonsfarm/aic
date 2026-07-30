#!/usr/bin/env python3
"""Deliver durable public-contact notifications through provider-neutral SMTP."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from email.policy import SMTP as SMTP_POLICY
from email.utils import format_datetime
import ipaddress
import os
from pathlib import Path
import re
import smtplib
import socket
import ssl
from typing import Any, Iterable

import psycopg
from psycopg.rows import dict_row

try:
    from scripts.aic_database_env import database_dsn, load_canonical_aic_env
except ModuleNotFoundError:  # Direct execution from /mnt/storage/aic/scripts.
    from aic_database_env import database_dsn, load_canonical_aic_env


DEFAULT_ENV_FILE = Path("/mnt/storage/aic/.env")
MAX_ATTEMPTS = 8
MAX_MESSAGE_BYTES = 32_768
STALE_RUNNING_SECONDS = 600
SMTP_TIMEOUT_SECONDS = 30.0
HOST_LABEL_PATTERN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$")
MAILBOX_PATTERN = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_{|}~-]{1,64}@"
    r"(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$"
)
CONTROL_PATTERN = re.compile(r"[\x00-\x1f\x7f]")
BODY_CONTROL_PATTERN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class PermanentDeliveryError(RuntimeError):
    """A stored message cannot be represented safely and should not be retried."""


@dataclass(frozen=True)
class SmtpConfig:
    host: str
    port: int
    username: str
    password: str
    starttls: bool
    from_address: str
    to_address: str


def load_env(path: Path) -> None:
    load_canonical_aic_env(path)


def dsn() -> str:
    return database_dsn(application_name="aic-contact-email-worker")


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def _valid_host(value: str) -> bool:
    if not value or len(value) > 253 or CONTROL_PATTERN.search(value) or any(char in value for char in " /\\"):
        return False
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return all(HOST_LABEL_PATTERN.fullmatch(label) for label in value.split("."))


def _loopback_host(value: str) -> bool:
    normalized = value.lower()
    if normalized in {"localhost", "::1"}:
        return True
    try:
        address = ipaddress.ip_address(normalized)
        return isinstance(address, ipaddress.IPv4Address) and address.is_loopback
    except ValueError:
        return False


def _valid_mailbox(value: str) -> bool:
    if not value or len(value) > 254 or CONTROL_PATTERN.search(value):
        return False
    try:
        value.encode("ascii")
    except UnicodeEncodeError:
        return False
    if not MAILBOX_PATTERN.fullmatch(value):
        return False
    local = value.split("@", 1)[0]
    return not (local.startswith(".") or local.endswith(".") or ".." in local)


def read_config() -> SmtpConfig | None:
    enabled = _env("CONTACT_EMAIL_DELIVERY_ENABLED").lower()
    if enabled not in {"", "false", "true"}:
        raise ValueError("CONTACT_EMAIL_DELIVERY_ENABLED must be exactly true or false.")
    if enabled != "true":
        return None

    names = (
        "CONTACT_EMAIL_SMTP_HOST",
        "CONTACT_EMAIL_SMTP_PORT",
        "CONTACT_EMAIL_SMTP_USERNAME",
        "CONTACT_EMAIL_SMTP_PASSWORD",
        "CONTACT_EMAIL_SMTP_STARTTLS",
        "CONTACT_EMAIL_FROM",
        "CONTACT_EMAIL_TO",
    )
    values = {name: _env(name) for name in names}
    if not all(values.values()):
        raise ValueError("Contact email delivery is enabled but the SMTP configuration is incomplete.")

    host = values["CONTACT_EMAIL_SMTP_HOST"]
    port_text = values["CONTACT_EMAIL_SMTP_PORT"]
    starttls_text = values["CONTACT_EMAIL_SMTP_STARTTLS"].lower()
    username = values["CONTACT_EMAIL_SMTP_USERNAME"]
    password = values["CONTACT_EMAIL_SMTP_PASSWORD"]
    from_address = values["CONTACT_EMAIL_FROM"].lower()
    to_address = values["CONTACT_EMAIL_TO"].lower()

    if not _valid_host(host):
        raise ValueError("CONTACT_EMAIL_SMTP_HOST is invalid.")
    if not port_text.isascii() or not port_text.isdecimal() or not 1 <= int(port_text) <= 65_535:
        raise ValueError("CONTACT_EMAIL_SMTP_PORT is invalid.")
    if starttls_text not in {"true", "false"}:
        raise ValueError("CONTACT_EMAIL_SMTP_STARTTLS must be exactly true or false.")
    if starttls_text == "false" and not _loopback_host(host):
        raise ValueError("CONTACT_EMAIL_SMTP_STARTTLS may be false only for a loopback SMTP relay.")
    if len(username) > 512 or len(password) > 1024 or CONTROL_PATTERN.search(username) or CONTROL_PATTERN.search(password):
        raise ValueError("SMTP credentials contain unsupported characters or exceed the size limit.")
    if not _valid_mailbox(from_address):
        raise ValueError("CONTACT_EMAIL_FROM must be one plain ASCII mailbox.")
    if not _valid_mailbox(to_address):
        raise ValueError("CONTACT_EMAIL_TO must be one plain ASCII mailbox.")

    return SmtpConfig(
        host=host,
        port=int(port_text),
        username=username,
        password=password,
        starttls=starttls_text == "true",
        from_address=from_address,
        to_address=to_address,
    )


def safe_error(value: str, sensitive_values: Iterable[str] = (), limit: int = 700) -> str:
    text = str(value)
    for sensitive in sensitive_values:
        if sensitive:
            text = text.replace(sensitive, "[redacted]")
    text = re.sub(
        r"(?i)(authorization|password|secret|api[_-]?key|token|credential)\s*[:=]\s*[^\s,;]+",
        r"\1=[redacted]",
        text,
    )
    text = re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[email-redacted]", text, flags=re.IGNORECASE)
    text = CONTROL_PATTERN.sub(" ", text)
    return text[-limit:].strip() or "SMTP delivery failed without a provider detail."


def _single_line(
    value: Any,
    *,
    field: str,
    limit: int,
    required: bool = False,
) -> str:
    text = str(value or "").strip()
    if (required and not text) or len(text) > limit or CONTROL_PATTERN.search(text):
        raise PermanentDeliveryError(f"Stored contact {field} is not safe for email delivery.")
    return text


def _header(value: Any, *, field: str, limit: int) -> str:
    return _single_line(value, field=field, limit=limit, required=True)


def _body(value: Any, *, field: str, limit: int, required: bool = False) -> str:
    text = str(value or "").strip()
    if (required and not text) or len(text) > limit or BODY_CONTROL_PATTERN.search(text):
        raise PermanentDeliveryError(f"Stored contact {field} is not safe for email delivery.")
    return text


def build_message(
    config: SmtpConfig,
    item: dict[str, Any],
    *,
    now: datetime | None = None,
) -> EmailMessage:
    public_id = _header(item.get("public_id"), field="identifier", limit=36).lower()
    if not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", public_id):
        raise PermanentDeliveryError("Stored contact identifier is not safe for email delivery.")

    category = _header(item.get("category"), field="category", limit=32)
    name = _single_line(item.get("name"), field="name", limit=120, required=True)
    contact_email = _single_line(item.get("email"), field="email", limit=254, required=True).lower()
    reply_to = contact_email if _valid_mailbox(contact_email) else None
    phone = _single_line(item.get("phone"), field="phone", limit=40)
    organization = _single_line(item.get("organization"), field="organization", limit=160)
    subject = _header(item.get("subject"), field="subject", limit=160)
    body_text = _body(item.get("message"), field="message", limit=5_000, required=True)

    message = EmailMessage(policy=SMTP_POLICY)
    message["From"] = config.from_address
    message["To"] = config.to_address
    if reply_to:
        message["Reply-To"] = reply_to
    message["Subject"] = f"PastorWood contact: {subject}"
    message["Date"] = format_datetime(now or datetime.now(timezone.utc))
    message["Message-ID"] = f"<aic-contact-{public_id}@{config.from_address.rsplit('@', 1)[1]}>"
    message["Auto-Submitted"] = "auto-generated"
    message.set_content(
        "\n".join(
            (
                "A contact message was accepted and stored by PastorWood.org.",
                "",
                f"Contact ID: {public_id}",
                f"Category: {category}",
                f"Name: {name}",
                f"Email: {contact_email}",
                f"Phone: {phone or 'Not provided'}",
                f"Organization: {organization or 'Not provided'}",
                f"Subject: {subject}",
                "",
                "Message:",
                body_text,
                "",
                "Review and manage this message in the protected contact inbox.",
            )
        )
    )
    if len(message.as_bytes(policy=SMTP_POLICY)) > MAX_MESSAGE_BYTES:
        raise PermanentDeliveryError("Stored contact exceeds the fixed email message size limit.")
    return message


def send_smtp(config: SmtpConfig, message: EmailMessage, timeout: float = SMTP_TIMEOUT_SECONDS) -> None:
    client = smtplib.SMTP(config.host, config.port, timeout=timeout)
    try:
        client.ehlo()
        if config.starttls:
            client.starttls(context=ssl.create_default_context())
            client.ehlo()
        client.login(config.username, config.password)
        refused = client.send_message(
            message,
            from_addr=config.from_address,
            to_addrs=[config.to_address],
        )
        if refused:
            raise RuntimeError("SMTP server refused the configured notification recipient.")
    finally:
        try:
            client.quit()
        except Exception:
            client.close()


def recover_stale(conn: psycopg.Connection[Any]) -> int:
    with conn.transaction():
        rows = conn.execute(
            """
            with stale as materialized (
              select outbox.contact_message_id
              from public_contact_notification_outbox outbox
              where outbox.status = 'running'
                and outbox.started_at < now() - make_interval(secs => %s)
              order by outbox.started_at, outbox.contact_message_id
              for update of outbox skip locked
              limit 100
            ), recovered as (
              update public_contact_notification_outbox outbox
              set status = case when outbox.attempt_count + 1 >= %s then 'failed' else 'queued' end,
                  attempt_count = outbox.attempt_count + 1,
                  available_at = now(),
                  started_at = null,
                  completed_at = case when outbox.attempt_count + 1 >= %s then now() else null end,
                  worker_id = '',
                  last_error = 'Worker stopped before recording an SMTP outcome.',
                  updated_at = now()
              from stale
              where outbox.contact_message_id = stale.contact_message_id
              returning outbox.contact_message_id, outbox.status, outbox.attempt_count
            ), updated_messages as (
              update public_contact_messages messages
              set notification_status = case when recovered.status = 'failed' then 'failed' else 'pending' end,
                  notification_detail = case
                    when recovered.status = 'failed'
                      then format('Delivery outcome was not recorded after %s interrupted attempts; automatic retries stopped.', recovered.attempt_count)
                    else format('A prior delivery attempt ended without a recorded result; retry %s is queued.', recovered.attempt_count + 1)
                  end,
                  updated_at = now()
              from recovered
              where messages.id = recovered.contact_message_id
              returning messages.id
            ), recorded_events as (
              insert into public_contact_message_events(
                contact_message_id, event_type, actor_type, note, metadata
              )
              select recovered.contact_message_id,
                     case when recovered.status = 'failed' then 'notification_failed' else 'notification_recovered' end,
                     'system_worker',
                     case
                       when recovered.status = 'failed' then 'Interrupted delivery reached the retry limit; the SMTP outcome is unknown.'
                       else 'Interrupted delivery had no recorded SMTP outcome and was queued again.'
                     end,
                     jsonb_build_object(
                       'attempt', recovered.attempt_count,
                       'terminal', recovered.status = 'failed',
                       'outcome', 'unknown'
                     )
              from recovered
              returning contact_message_id
            )
            select recovered.contact_message_id
            from recovered
            left join updated_messages on updated_messages.id = recovered.contact_message_id
            left join recorded_events on recorded_events.contact_message_id = recovered.contact_message_id
            """,
            (STALE_RUNNING_SECONDS, MAX_ATTEMPTS, MAX_ATTEMPTS),
        ).fetchall()
    return len(rows)


def claim_request(conn: psycopg.Connection[Any], worker_id: str) -> dict[str, Any] | None:
    with conn.transaction():
        row = conn.execute(
            """
            select outbox.contact_message_id, outbox.generation, outbox.attempt_count,
                   messages.public_id::text, messages.category, messages.name, messages.email,
                   coalesce(messages.phone, '') as phone,
                   coalesce(messages.organization, '') as organization,
                   messages.subject, messages.message
            from public_contact_notification_outbox outbox
            join public_contact_messages messages on messages.id = outbox.contact_message_id
            where outbox.status = 'queued'
              and outbox.available_at <= now()
              and outbox.attempt_count < %s
            order by outbox.available_at, outbox.updated_at, outbox.contact_message_id
            for update of outbox skip locked
            limit 1
            """,
            (MAX_ATTEMPTS,),
        ).fetchone()
        if not row:
            return None
        claimed = conn.execute(
            """
            update public_contact_notification_outbox
            set status = 'running',
                started_at = now(),
                completed_at = null,
                worker_id = %s,
                last_error = '',
                updated_at = now()
            where contact_message_id = %s
              and generation = %s
              and status = 'queued'
            returning contact_message_id
            """,
            (worker_id, row["contact_message_id"], row["generation"]),
        ).fetchone()
        return dict(row) if claimed else None


def complete_request(conn: psycopg.Connection[Any], item: dict[str, Any], worker_id: str) -> bool:
    attempt = int(item["attempt_count"]) + 1
    with conn.transaction():
        completed = conn.execute(
            """
            update public_contact_notification_outbox
            set status = 'completed',
                attempt_count = attempt_count + 1,
                started_at = null,
                completed_at = now(),
                worker_id = '',
                last_error = '',
                updated_at = now()
            where contact_message_id = %s
              and generation = %s
              and status = 'running'
              and worker_id = %s
            returning contact_message_id
            """,
            (item["contact_message_id"], item["generation"], worker_id),
        ).fetchone()
        if not completed:
            return False
        conn.execute(
            """
            update public_contact_messages
            set notification_status = 'sent',
                notification_detail = 'SMTP server accepted the notification for delivery.',
                notified_at = now(),
                updated_at = now()
            where id = %s
            """,
            (item["contact_message_id"],),
        )
        conn.execute(
            """
            insert into public_contact_message_events(
              contact_message_id, event_type, actor_type, note, metadata
            )
            values (
              %s, 'notification_sent', 'system_worker',
              'SMTP server accepted the notification for delivery.',
              jsonb_build_object('attempt', %s)
            )
            """,
            (item["contact_message_id"], attempt),
        )
        return True


def retry_delay_seconds(attempt: int) -> int:
    return min(21_600, 60 * (2 ** max(0, min(attempt - 1, 10))))


def fail_request(
    conn: psycopg.Connection[Any],
    item: dict[str, Any],
    worker_id: str,
    message: str,
    *,
    permanent: bool = False,
) -> bool:
    requested_attempt = int(item["attempt_count"]) + 1
    terminal = permanent or requested_attempt >= MAX_ATTEMPTS
    status = "failed" if terminal else "queued"
    delay_seconds = 0 if terminal else retry_delay_seconds(requested_attempt)
    detail = safe_error(message)
    with conn.transaction():
        failed = conn.execute(
            """
            update public_contact_notification_outbox
            set status = %s,
                attempt_count = attempt_count + 1,
                available_at = now() + make_interval(secs => %s),
                started_at = null,
                completed_at = case when %s = 'failed' then now() else null end,
                worker_id = '',
                last_error = %s,
                updated_at = now()
            where contact_message_id = %s
              and generation = %s
              and status = 'running'
              and worker_id = %s
            returning contact_message_id, attempt_count, available_at::text
            """,
            (
                status,
                delay_seconds,
                status,
                detail,
                item["contact_message_id"],
                item["generation"],
                worker_id,
            ),
        ).fetchone()
        if not failed:
            return False

        attempt = int(failed["attempt_count"])
        retry_at = str(failed["available_at"])
        if terminal:
            notification_detail = (
                f"SMTP notification delivery stopped after {attempt} unsuccessful attempts. "
                f"Last error: {detail}"
            )
        else:
            notification_detail = (
                f"SMTP delivery attempt {attempt} failed; retry scheduled after {retry_at}. "
                f"Last error: {detail}"
            )
        conn.execute(
            """
            update public_contact_messages
            set notification_status = %s,
                notification_detail = %s,
                updated_at = now()
            where id = %s
            """,
            ("failed" if terminal else "pending", notification_detail, item["contact_message_id"]),
        )
        conn.execute(
            """
            insert into public_contact_message_events(
              contact_message_id, event_type, actor_type, note, metadata
            )
            values (
              %s, 'notification_failed', 'system_worker', %s,
              jsonb_build_object('attempt', %s, 'terminal', %s, 'retryAt', %s)
            )
            """,
            (
                item["contact_message_id"],
                detail[:500],
                attempt,
                terminal,
                None if terminal else retry_at,
            ),
        )
        return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Process queued public-contact SMTP notifications.")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--check-config", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_env(args.env_file)
    try:
        config = read_config()
    except ValueError as exc:
        print(f"configured=0 reason={safe_error(str(exc))} recovered=0 processed=0 completed=0 failed=0 superseded=0")
        return 2
    if config is None:
        print("configured=0 recovered=0 processed=0 completed=0 failed=0 superseded=0")
        return 2 if args.check_config else 0
    if args.check_config:
        print("configured=1")
        return 0

    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    processed = completed = failed = superseded = accepted_unrecorded = 0
    sensitive = (config.username, config.password, config.from_address, config.to_address)
    with psycopg.connect(dsn(), row_factory=dict_row) as conn:
        recovered = recover_stale(conn)
        while processed < max(1, min(args.limit, 100)):
            item = claim_request(conn, worker_id)
            if not item:
                break
            processed += 1
            try:
                message = build_message(config, item)
                send_smtp(config, message)
            except Exception as exc:
                provider_detail = safe_error(str(exc), sensitive)
                if fail_request(
                    conn,
                    item,
                    worker_id,
                    provider_detail,
                    permanent=isinstance(exc, PermanentDeliveryError),
                ):
                    failed += 1
                else:
                    superseded += 1
                continue

            try:
                finalized = complete_request(conn, item, worker_id)
            except Exception:
                # SMTP already accepted the stable Message-ID. Leave the guarded
                # running claim untouched so stale recovery records an unknown
                # outcome; never relabel acceptance as a transport failure.
                accepted_unrecorded += 1
                break
            if finalized:
                completed += 1
            else:
                superseded += 1
    print(
        f"configured=1 recovered={recovered} processed={processed} completed={completed} "
        f"failed={failed} superseded={superseded} accepted_unrecorded={accepted_unrecorded}"
    )
    return 1 if accepted_unrecorded else 0


if __name__ == "__main__":
    raise SystemExit(main())
