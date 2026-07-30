from __future__ import annotations

import argparse
from contextlib import redirect_stdout
from datetime import datetime, timezone
from email.policy import SMTP as SMTP_POLICY
import importlib.util
import io
import os
from pathlib import Path
import sys
import types
import unittest
from unittest import mock


PSYCOPG_STUB = types.ModuleType("psycopg")
PSYCOPG_STUB.Connection = object
PSYCOPG_ROWS_STUB = types.ModuleType("psycopg.rows")
PSYCOPG_ROWS_STUB.dict_row = object()
sys.modules.setdefault("psycopg", PSYCOPG_STUB)
sys.modules.setdefault("psycopg.rows", PSYCOPG_ROWS_STUB)

SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "process_contact_email_outbox.py"
SPEC = importlib.util.spec_from_file_location("process_contact_email_outbox", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class Result:
    def __init__(self, row=None, rows=None):
        self._row = row
        self._rows = rows or []

    def fetchone(self):
        return self._row

    def fetchall(self):
        return self._rows


class Transaction:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class Connection:
    def __init__(self, results):
        self.results = list(results)
        self.calls = []

    def transaction(self):
        return Transaction()

    def execute(self, sql, params=()):
        self.calls.append((sql, params))
        if not self.results:
            raise AssertionError("Unexpected SQL execution")
        return self.results.pop(0)


def complete_environment(**overrides):
    values = {
        "CONTACT_EMAIL_DELIVERY_ENABLED": "true",
        "CONTACT_EMAIL_SMTP_HOST": "smtp.example.org",
        "CONTACT_EMAIL_SMTP_PORT": "587",
        "CONTACT_EMAIL_SMTP_USERNAME": "smtp-user",
        "CONTACT_EMAIL_SMTP_PASSWORD": "test-only-password",
        "CONTACT_EMAIL_SMTP_STARTTLS": "true",
        "CONTACT_EMAIL_FROM": "contact@example.org",
        "CONTACT_EMAIL_TO": "office@example.org",
    }
    values.update(overrides)
    return values


def contact_item(**overrides):
    values = {
        "contact_message_id": 42,
        "generation": 1,
        "attempt_count": 0,
        "public_id": "6c73d469-4d19-4bc2-a2fa-1f6f0a4f7b50",
        "category": "general",
        "name": "Jane Listener",
        "email": "jane@example.org",
        "phone": "+1 865 555 0100",
        "organization": "Mountain Conference",
        "subject": "Question about a sermon",
        "message": "Could someone help me find the referenced study notes?",
    }
    values.update(overrides)
    return values


class ContactEmailWorkerTests(unittest.TestCase):
    def test_config_is_disabled_by_default_but_enabled_incomplete_is_an_error(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(MODULE.read_config())
        with mock.patch.dict(os.environ, {"CONTACT_EMAIL_DELIVERY_ENABLED": "false"}, clear=True):
            self.assertIsNone(MODULE.read_config())
        incomplete = complete_environment(CONTACT_EMAIL_TO="")
        with mock.patch.dict(os.environ, incomplete, clear=True):
            with self.assertRaisesRegex(ValueError, "enabled.*incomplete"):
                MODULE.read_config()

    def test_config_requires_valid_bounded_values_and_remote_starttls(self) -> None:
        with mock.patch.dict(os.environ, complete_environment(), clear=True):
            config = MODULE.read_config()
        self.assertIsNotNone(config)
        self.assertTrue(config.starttls)
        self.assertEqual(config.port, 587)

        invalid_cases = (
            {"CONTACT_EMAIL_DELIVERY_ENABLED": "yes"},
            {"CONTACT_EMAIL_SMTP_HOST": "smtp.example.org/path"},
            {"CONTACT_EMAIL_SMTP_PORT": "70000"},
            {"CONTACT_EMAIL_TO": "office@example.org\r\nBcc: attacker@example.org"},
            {"CONTACT_EMAIL_SMTP_HOST": "smtp.example.org", "CONTACT_EMAIL_SMTP_STARTTLS": "false"},
            {"CONTACT_EMAIL_SMTP_HOST": "127.evil", "CONTACT_EMAIL_SMTP_STARTTLS": "false"},
        )
        for overrides in invalid_cases:
            with self.subTest(overrides=overrides):
                with mock.patch.dict(os.environ, complete_environment(**overrides), clear=True):
                    with self.assertRaises(ValueError):
                        MODULE.read_config()

        with mock.patch.dict(
            os.environ,
            complete_environment(
                CONTACT_EMAIL_SMTP_HOST="127.0.0.1",
                CONTACT_EMAIL_SMTP_STARTTLS="false",
            ),
            clear=True,
        ):
            loopback = MODULE.read_config()
        self.assertIsNotNone(loopback)
        self.assertFalse(loopback.starttls)

    def test_message_is_fixed_bounded_crlf_encoded_and_header_safe(self) -> None:
        with mock.patch.dict(os.environ, complete_environment(), clear=True):
            config = MODULE.read_config()
        self.assertIsNotNone(config)
        message = MODULE.build_message(
            config,
            contact_item(),
            now=datetime(2026, 7, 30, tzinfo=timezone.utc),
        )
        raw = message.as_bytes(policy=SMTP_POLICY)
        self.assertLessEqual(len(raw), MODULE.MAX_MESSAGE_BYTES)
        self.assertIn(b"\r\nSubject: PastorWood contact: Question about a sermon\r\n", raw)
        self.assertIn(
            b"Message-ID: <aic-contact-6c73d469-4d19-4bc2-a2fa-1f6f0a4f7b50@example.org>",
            raw,
        )
        self.assertEqual(message["Reply-To"], "jane@example.org")
        self.assertNotIn("test-only-password", raw.decode("utf-8"))

        for field, value in (
            ("subject", "Question\r\nBcc: attacker@example.org"),
            ("email", "jane@example.org\r\nBcc: attacker@example.org"),
            ("name", "Jane\x00Listener"),
        ):
            with self.subTest(field=field):
                with self.assertRaises(MODULE.PermanentDeliveryError):
                    MODULE.build_message(config, contact_item(**{field: value}))

    def test_legacy_loose_or_unicode_address_is_delivered_as_body_text_without_reply_to(self) -> None:
        with mock.patch.dict(os.environ, complete_environment(), clear=True):
            config = MODULE.read_config()
        self.assertIsNotNone(config)
        delivered = []

        class FakeSmtp:
            def __init__(self, _host, _port, timeout):
                self.timeout = timeout

            def ehlo(self):
                return None

            def starttls(self, *, context):
                return context

            def login(self, _username, _password):
                return None

            def send_message(self, sent, *, from_addr, to_addrs):
                delivered.append((sent, from_addr, to_addrs))
                return {}

            def quit(self):
                return None

            def close(self):
                return None

        with mock.patch.object(MODULE.smtplib, "SMTP", FakeSmtp):
            for address in ("jos\u00e9@example.org", "listener..name@example.org"):
                with self.subTest(address=address):
                    message = MODULE.build_message(config, contact_item(email=address))
                    self.assertIsNone(message["Reply-To"])
                    self.assertIn(f"Email: {address}", message.get_content())
                    MODULE.send_smtp(config, message)

        self.assertEqual(len(delivered), 2)
        self.assertTrue(all(entry[1:] == ("contact@example.org", ["office@example.org"]) for entry in delivered))

    def test_smtp_transport_uses_starttls_login_and_one_fixed_recipient(self) -> None:
        with mock.patch.dict(os.environ, complete_environment(), clear=True):
            config = MODULE.read_config()
        self.assertIsNotNone(config)
        message = MODULE.build_message(config, contact_item())
        calls = []

        class FakeSmtp:
            def __init__(self, host, port, timeout):
                calls.append(("connect", host, port, timeout))

            def ehlo(self):
                calls.append(("ehlo",))

            def starttls(self, *, context):
                calls.append(("starttls", context))

            def login(self, username, password):
                calls.append(("login", username, password))

            def send_message(self, sent, *, from_addr, to_addrs):
                calls.append(("send", sent, from_addr, to_addrs))
                return {}

            def quit(self):
                calls.append(("quit",))

            def close(self):
                calls.append(("close",))

        tls_context = object()
        with mock.patch.object(MODULE.smtplib, "SMTP", FakeSmtp), mock.patch.object(
            MODULE.ssl,
            "create_default_context",
            return_value=tls_context,
        ):
            MODULE.send_smtp(config, message, timeout=12.0)

        self.assertEqual(calls[0], ("connect", "smtp.example.org", 587, 12.0))
        self.assertIn(("starttls", tls_context), calls)
        self.assertIn(("login", "smtp-user", "test-only-password"), calls)
        send = next(call for call in calls if call[0] == "send")
        self.assertEqual(send[2], "contact@example.org")
        self.assertEqual(send[3], ["office@example.org"])

    def test_claim_is_skip_locked_and_lost_claim_is_not_processed(self) -> None:
        row = contact_item()
        connection = Connection([Result(row=row), Result(row={"contact_message_id": 42})])
        claimed = MODULE.claim_request(connection, "worker-1")
        self.assertEqual(claimed["contact_message_id"], 42)
        self.assertIn("for update of outbox skip locked", connection.calls[0][0].lower())
        self.assertIn("status = 'queued'", connection.calls[1][0])
        self.assertEqual(connection.calls[0][1], (MODULE.MAX_ATTEMPTS,))

        lost = Connection([Result(row=row), Result(row=None)])
        self.assertIsNone(MODULE.claim_request(lost, "worker-2"))

    def test_completion_is_guarded_idempotent_and_updates_status_and_audit(self) -> None:
        connection = Connection([
            Result(row={"contact_message_id": 42}),
            Result(),
            Result(),
        ])
        self.assertTrue(MODULE.complete_request(connection, contact_item(), "worker-1"))
        self.assertIn("status = 'running'", connection.calls[0][0])
        self.assertIn("worker_id = %s", connection.calls[0][0])
        self.assertIn("notification_status = 'sent'", connection.calls[1][0])
        self.assertIn("'notification_sent'", connection.calls[2][0])

        already_done = Connection([Result(row=None)])
        self.assertFalse(MODULE.complete_request(already_done, contact_item(), "worker-1"))
        self.assertEqual(len(already_done.calls), 1)

    def test_failure_uses_bounded_backoff_and_terminal_retry_limit(self) -> None:
        retrying = Connection([
            Result(row={
                "contact_message_id": 42,
                "attempt_count": 1,
                "available_at": "2026-07-30 12:01:00+00",
            }),
            Result(),
            Result(),
        ])
        self.assertTrue(MODULE.fail_request(
            retrying,
            contact_item(attempt_count=0),
            "worker-1",
            "temporary provider failure",
        ))
        first_params = retrying.calls[0][1]
        self.assertEqual(first_params[0], "queued")
        self.assertEqual(first_params[1], 60)
        self.assertEqual(retrying.calls[1][1][0], "pending")
        self.assertIn("retry scheduled after", retrying.calls[1][1][1])
        self.assertIn("'notification_failed'", retrying.calls[2][0])
        self.assertFalse(retrying.calls[2][1][3])

        terminal = Connection([
            Result(row={
                "contact_message_id": 42,
                "attempt_count": MODULE.MAX_ATTEMPTS,
                "available_at": "2026-07-30 12:00:00+00",
            }),
            Result(),
            Result(),
        ])
        self.assertTrue(MODULE.fail_request(
            terminal,
            contact_item(attempt_count=MODULE.MAX_ATTEMPTS - 1),
            "worker-1",
            "still failing",
        ))
        terminal_params = terminal.calls[0][1]
        self.assertEqual(terminal_params[0], "failed")
        self.assertEqual(terminal_params[1], 0)
        self.assertEqual(terminal.calls[1][1][0], "failed")
        self.assertTrue(terminal.calls[2][1][3])
        self.assertEqual(MODULE.retry_delay_seconds(50), 21_600)

    def test_permanent_message_failure_stops_after_one_attempt(self) -> None:
        connection = Connection([
            Result(row={
                "contact_message_id": 42,
                "attempt_count": 1,
                "available_at": "2026-07-30 12:00:00+00",
            }),
            Result(),
            Result(),
        ])
        self.assertTrue(MODULE.fail_request(
            connection,
            contact_item(),
            "worker-1",
            "Stored contact subject is not safe for email delivery.",
            permanent=True,
        ))
        self.assertEqual(connection.calls[0][1][0], "failed")
        self.assertEqual(connection.calls[1][1][0], "failed")

    def test_stale_recovery_is_bounded_locked_and_truthful_about_unknown_outcome(self) -> None:
        connection = Connection([Result(rows=[{"contact_message_id": 42}])])
        self.assertEqual(MODULE.recover_stale(connection), 1)
        sql, params = connection.calls[0]
        self.assertIn("for update of outbox skip locked", sql.lower())
        self.assertIn("limit 100", sql.lower())
        self.assertIn("'notification_recovered'", sql)
        self.assertIn("'outcome', 'unknown'", sql)
        self.assertEqual(
            params,
            (MODULE.STALE_RUNNING_SECONDS, MODULE.MAX_ATTEMPTS, MODULE.MAX_ATTEMPTS),
        )

    def test_smtp_acceptance_followed_by_finalize_error_is_not_marked_or_retried_as_failure(self) -> None:
        args = argparse.Namespace(
            env_file=MODULE.DEFAULT_ENV_FILE,
            limit=25,
            check_config=False,
        )
        config = MODULE.SmtpConfig(
            host="smtp.example.org",
            port=587,
            username="smtp-user",
            password="test-only-password",
            starttls=True,
            from_address="contact@example.org",
            to_address="office@example.org",
        )
        item = contact_item()
        connection = object()
        built_message = object()

        with (
            mock.patch.object(MODULE, "parse_args", return_value=args),
            mock.patch.object(MODULE, "load_env"),
            mock.patch.object(MODULE, "read_config", return_value=config),
            mock.patch.object(MODULE, "dsn", return_value="test-dsn"),
            mock.patch.object(MODULE.psycopg, "connect", create=True) as connect,
            mock.patch.object(MODULE, "recover_stale", return_value=0),
            mock.patch.object(MODULE, "claim_request", side_effect=[item, None]) as claim,
            mock.patch.object(MODULE, "build_message", return_value=built_message),
            mock.patch.object(MODULE, "send_smtp") as send,
            mock.patch.object(MODULE, "complete_request", side_effect=RuntimeError("database finalize failed")) as complete,
            mock.patch.object(MODULE, "fail_request") as fail,
        ):
            connect.return_value.__enter__.return_value = connection
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(MODULE.main(), 1)

        send.assert_called_once_with(config, built_message)
        complete.assert_called_once()
        fail.assert_not_called()
        claim.assert_called_once()
        self.assertIn("processed=1", output.getvalue())
        self.assertIn("failed=0", output.getvalue())
        self.assertIn("accepted_unrecorded=1", output.getvalue())

    def test_disabled_is_clean_noop_but_enabled_incomplete_fails_without_db_claim(self) -> None:
        args = argparse.Namespace(
            env_file=MODULE.DEFAULT_ENV_FILE,
            limit=25,
            check_config=False,
        )
        with mock.patch.object(MODULE, "parse_args", return_value=args), mock.patch.object(
            MODULE,
            "load_env",
        ), mock.patch.object(MODULE.psycopg, "connect", create=True) as connect:
            with mock.patch.dict(os.environ, {"CONTACT_EMAIL_DELIVERY_ENABLED": "false"}, clear=True):
                output = io.StringIO()
                with redirect_stdout(output):
                    self.assertEqual(MODULE.main(), 0)
            connect.assert_not_called()
            self.assertIn("configured=0", output.getvalue())

            secret = "must-never-be-printed"
            with mock.patch.dict(
                os.environ,
                complete_environment(
                    CONTACT_EMAIL_SMTP_PASSWORD=secret,
                    CONTACT_EMAIL_TO="",
                ),
                clear=True,
            ):
                output = io.StringIO()
                with redirect_stdout(output):
                    self.assertEqual(MODULE.main(), 2)
            connect.assert_not_called()
            self.assertIn("incomplete", output.getvalue())
            self.assertNotIn(secret, output.getvalue())

    def test_error_text_redacts_credentials_and_addresses(self) -> None:
        cleaned = MODULE.safe_error(
            "password=secret-value office@example.org",
            ("secret-value",),
        )
        self.assertNotIn("secret-value", cleaned)
        self.assertNotIn("office@example.org", cleaned)
        self.assertIn("[redacted]", cleaned)
        self.assertIn("[email-redacted]", cleaned)


if __name__ == "__main__":
    unittest.main()
