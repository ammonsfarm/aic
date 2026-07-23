#!/usr/bin/env python3
"""Synchronize the durable Pastor Wood subscription outbox with Mailchimp."""

from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import socket
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

import psycopg
from psycopg.rows import dict_row

try:
    from scripts.aic_database_env import database_dsn, load_canonical_aic_env
except ModuleNotFoundError:  # Direct execution from /mnt/storage/aic/scripts.
    from aic_database_env import database_dsn, load_canonical_aic_env


DEFAULT_ENV_FILE = Path("/mnt/storage/aic/.env")
MAX_ATTEMPTS = 10
STALE_RUNNING_SECONDS = 600


def load_env(path: Path) -> None:
    load_canonical_aic_env(path)


def dsn() -> str:
    return database_dsn(application_name="aic-subscription-provider-worker")


@dataclass(frozen=True)
class MailchimpConfig:
    api_key: str
    server_prefix: str
    audience_id: str

    @property
    def api_root(self) -> str:
        return f"https://{self.server_prefix}.api.mailchimp.com/3.0"


def read_config() -> MailchimpConfig | None:
    api_key = os.environ.get("MAILCHIMP_API_KEY", "").strip()
    server_prefix = os.environ.get("MAILCHIMP_SERVER_PREFIX", "").strip().lower()
    audience_id = os.environ.get("MAILCHIMP_AUDIENCE_ID", "").strip()
    required_settings = (
        api_key,
        server_prefix,
        audience_id,
        os.environ.get("MAILCHIMP_WEBHOOK_SECRET", "").strip(),
        os.environ.get("SUBSCRIPTION_RATE_LIMIT_SECRET", "").strip(),
        os.environ.get("SUBSCRIPTION_UNSUBSCRIBE_SECRET", "").strip(),
    )
    if not all(required_settings):
        return None
    if not re.fullmatch(r"[a-z0-9-]{2,24}", server_prefix):
        raise ValueError("MAILCHIMP_SERVER_PREFIX is invalid.")
    if not re.fullmatch(r"[a-f0-9]{10,32}", audience_id, re.IGNORECASE):
        raise ValueError("MAILCHIMP_AUDIENCE_ID is invalid.")
    return MailchimpConfig(api_key=api_key, server_prefix=server_prefix, audience_id=audience_id)


def safe_error(value: str, limit: int = 1_500) -> str:
    redacted = re.sub(r"(?i)(authorization|password|secret|api[_-]?key|token)\s*[:=]\s*[^\s,;]+", r"\1=[redacted]", value)
    redacted = re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[email-redacted]", redacted, flags=re.IGNORECASE)
    return redacted[-limit:].strip()


def recover_stale(conn: psycopg.Connection[Any]) -> int:
    with conn.transaction():
        rows = conn.execute(
            """
            update public_subscription_provider_outbox
               set status = 'failed',
                   attempt_count = attempt_count + 1,
                   available_at = now(),
                   worker_id = '',
                   last_error = 'Worker stopped before recording completion; request recovered.',
                   updated_at = now()
             where status = 'running'
               and started_at < now() - make_interval(secs => %s)
             returning subscription_id
            """,
            (STALE_RUNNING_SECONDS,),
        ).fetchall()
    return len(rows)


def claim_request(conn: psycopg.Connection[Any], worker_id: str) -> dict[str, Any] | None:
    with conn.transaction():
        row = conn.execute(
            """
            select outbox.subscription_id, outbox.desired_action, outbox.generation,
                   outbox.attempt_count, subscriptions.email
              from public_subscription_provider_outbox outbox
              join public_subscriptions subscriptions on subscriptions.id = outbox.subscription_id
             where outbox.status in ('queued', 'failed')
               and outbox.available_at <= now()
               and outbox.attempt_count < %s
             order by outbox.available_at, outbox.updated_at, outbox.subscription_id
             for update of outbox skip locked
             limit 1
            """,
            (MAX_ATTEMPTS,),
        ).fetchone()
        if not row:
            return None
        claimed = conn.execute(
            """
            update public_subscription_provider_outbox
               set status = 'running', started_at = now(), completed_at = null,
                   worker_id = %s, last_error = '', updated_at = now()
             where subscription_id = %s and generation = %s
             returning subscription_id
            """,
            (worker_id, row["subscription_id"], row["generation"]),
        ).fetchone()
        return dict(row) if claimed else None


def call_mailchimp(config: MailchimpConfig, item: dict[str, Any], timeout: float = 30.0) -> dict[str, str]:
    email = str(item["email"]).strip().lower()
    member_hash = hashlib.md5(email.encode("utf-8"), usedforsecurity=False).hexdigest()
    action = item["desired_action"]
    desired_status = "pending" if action == "subscribe" else "unsubscribed"
    payload = json.dumps(
        {
            "email_address": email,
            "status_if_new": desired_status,
            "status": desired_status,
        },
        separators=(",", ":"),
    ).encode("utf-8")
    credentials = base64.b64encode(f"aic:{config.api_key}".encode("utf-8")).decode("ascii")
    request = urlrequest.Request(
        f"{config.api_root}/lists/{config.audience_id}/members/{member_hash}",
        data=payload,
        method="PUT",
        headers={
            "Accept": "application/json",
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/json",
            "User-Agent": "PastorWood-subscription-sync/1.0",
        },
    )
    try:
        with urlrequest.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urlerror.HTTPError as exc:
        detail = exc.read(16_384).decode("utf-8", errors="replace")
        raise RuntimeError(f"Mailchimp returned HTTP {exc.code}: {safe_error(detail)}") from exc
    except urlerror.URLError as exc:
        raise RuntimeError(f"Mailchimp request failed: {safe_error(str(exc.reason))}") from exc
    member_id = str(body.get("id", "")).strip()
    provider_status = str(body.get("status", "")).strip().lower()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", member_id):
        raise RuntimeError("Mailchimp response did not contain a valid member id.")
    if provider_status not in {"pending", "subscribed", "unsubscribed", "cleaned"}:
        raise RuntimeError("Mailchimp response did not contain a supported member status.")
    return {"member_id": member_id, "provider_status": provider_status}


def complete_request(
    conn: psycopg.Connection[Any],
    item: dict[str, Any],
    worker_id: str,
    result: dict[str, str],
) -> bool:
    with conn.transaction():
        completed = conn.execute(
            """
            update public_subscription_provider_outbox
               set status = 'completed', attempt_count = attempt_count + 1,
                   completed_at = now(), worker_id = '', last_error = '', updated_at = now()
             where subscription_id = %s and generation = %s
               and status = 'running' and worker_id = %s
             returning subscription_id
            """,
            (item["subscription_id"], item["generation"], worker_id),
        ).fetchone()
        if not completed:
            return False
        conn.execute(
            """
            update public_subscriptions
               set provider_status = %s,
                   provider_member_id = %s,
                   provider_synced_at = now(),
                   provider_last_error = null,
                   status = case
                     when status = 'suppressed' then 'suppressed'
                     when %s = 'subscribed' then 'active'
                     else status
                   end,
                   updated_at = now()
             where id = %s
            """,
            (result["provider_status"], result["member_id"], result["provider_status"], item["subscription_id"]),
        )
        return True


def fail_request(conn: psycopg.Connection[Any], item: dict[str, Any], worker_id: str, message: str) -> bool:
    attempt = int(item["attempt_count"]) + 1
    delay_seconds = min(86_400, 60 * (2 ** min(attempt, 10)))
    detail = safe_error(message)
    with conn.transaction():
        failed = conn.execute(
            """
            update public_subscription_provider_outbox
               set status = 'failed', attempt_count = attempt_count + 1,
                   available_at = now() + make_interval(secs => %s),
                   worker_id = '', last_error = %s, updated_at = now()
             where subscription_id = %s and generation = %s
               and status = 'running' and worker_id = %s
             returning subscription_id
            """,
            (delay_seconds, detail, item["subscription_id"], item["generation"], worker_id),
        ).fetchone()
        if not failed:
            return False
        conn.execute(
            """
            update public_subscriptions
               set provider_status = 'error', provider_last_error = %s, updated_at = now()
             where id = %s
            """,
            (detail, item["subscription_id"]),
        )
        conn.execute(
            """
            insert into public_subscription_events(subscription_id, event_type, actor_type, metadata)
            values (%s, 'provider-sync-failed', 'system-worker',
                    jsonb_build_object('action', %s, 'attempt', %s))
            """,
            (item["subscription_id"], item["desired_action"], attempt),
        )
        return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Process queued Mailchimp subscription synchronization.")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--check-config", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_env(args.env_file)
    config = read_config()
    if config is None:
        print("configured=0 recovered=0 processed=0 completed=0 failed=0 superseded=0")
        return 2 if args.check_config else 0
    if args.check_config:
        print("configured=1")
        return 0

    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    processed = completed = failed = superseded = 0
    with psycopg.connect(dsn(), row_factory=dict_row) as conn:
        recovered = recover_stale(conn)
        while processed < max(1, min(args.limit, 100)):
            item = claim_request(conn, worker_id)
            if not item:
                break
            processed += 1
            try:
                result = call_mailchimp(config, item)
                if complete_request(conn, item, worker_id, result):
                    completed += 1
                else:
                    superseded += 1
            except Exception as exc:  # Every provider failure must become visible and retryable.
                if fail_request(conn, item, worker_id, str(exc)):
                    failed += 1
                else:
                    superseded += 1
    print(
        f"configured=1 recovered={recovered} processed={processed} completed={completed} "
        f"failed={failed} superseded={superseded}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
