from __future__ import annotations

import importlib.util
import json
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

SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "process_subscription_provider_outbox.py"
SPEC = importlib.util.spec_from_file_location("process_subscription_provider_outbox", SCRIPT_PATH)
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


class SubscriptionProviderWorkerTests(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["MAILCHIMP_API_KEY"] = "secret-value-us21"
        os.environ["MAILCHIMP_SERVER_PREFIX"] = "us21"
        os.environ["MAILCHIMP_AUDIENCE_ID"] = "9ad7bbba36"
        os.environ["MAILCHIMP_WEBHOOK_SECRET"] = "webhook-secret"
        os.environ["SUBSCRIPTION_RATE_LIMIT_SECRET"] = "rate-limit-secret"
        os.environ["SUBSCRIPTION_UNSUBSCRIBE_SECRET"] = "unsubscribe-secret"

    def test_config_requires_and_bounds_the_explicit_mailchimp_host(self) -> None:
        config = MODULE.read_config()
        self.assertIsNotNone(config)
        self.assertEqual(config.server_prefix, "us21")
        self.assertEqual(config.api_root, "https://us21.api.mailchimp.com/3.0")
        os.environ["MAILCHIMP_SERVER_PREFIX"] = "evil.example.com/path"
        with self.assertRaises(ValueError):
            MODULE.read_config()

    def test_missing_key_disables_worker_without_a_database_claim(self) -> None:
        os.environ.pop("MAILCHIMP_API_KEY", None)
        self.assertIsNone(MODULE.read_config())

    def test_subscribe_requests_mailchimp_double_opt_in(self) -> None:
        config = MODULE.read_config()
        self.assertIsNotNone(config)
        captured = {}

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps({"id": "member_1", "status": "pending"}).encode()

        def fake_urlopen(request, timeout):
            captured["url"] = request.full_url
            captured["payload"] = json.loads(request.data)
            captured["authorization"] = request.get_header("Authorization")
            captured["timeout"] = timeout
            return Response()

        with mock.patch.object(MODULE.urlrequest, "urlopen", fake_urlopen):
            result = MODULE.call_mailchimp(
                config,
                {"email": "listener@example.com", "desired_action": "subscribe"},
            )

        self.assertEqual(result, {"member_id": "member_1", "provider_status": "pending"})
        self.assertEqual(captured["url"], "https://us21.api.mailchimp.com/3.0/lists/9ad7bbba36/members/af9a3bac9e5693db82dee85f5fdc6bf5")
        self.assertEqual(captured["payload"]["status_if_new"], "pending")
        self.assertEqual(captured["payload"]["status"], "pending")
        self.assertTrue(captured["authorization"].startswith("Basic "))

    def test_failure_text_redacts_credentials_and_addresses(self) -> None:
        clean = MODULE.safe_error("Authorization: abc token=xyz listener@example.com")
        self.assertNotIn("abc", clean)
        self.assertNotIn("xyz", clean)
        self.assertNotIn("listener@example.com", clean)
        self.assertIn("[redacted]", clean)
        self.assertIn("[email-redacted]", clean)

    def test_stale_generation_cannot_complete_a_newer_action(self) -> None:
        class Connection:
            def __init__(self):
                self.calls = []

            def transaction(self):
                return Transaction()

            def execute(self, sql, params):
                self.calls.append((sql, params))
                return Result(None)

        connection = Connection()
        completed = MODULE.complete_request(
            connection,
            {"subscription_id": 42, "generation": 3},
            "worker-1",
            {"provider_status": "pending", "member_id": "member_1"},
        )
        self.assertFalse(completed)
        self.assertEqual(len(connection.calls), 1)
        sql, params = connection.calls[0]
        self.assertIn("generation = %s", sql)
        self.assertIn("status = 'running' and worker_id = %s", sql)
        self.assertEqual(params, (42, 3, "worker-1"))

    def test_claim_is_bounded_and_skip_locked(self) -> None:
        class Connection:
            def __init__(self):
                self.calls = []

            def transaction(self):
                return Transaction()

            def execute(self, sql, params):
                self.calls.append((sql, params))
                if "select outbox.subscription_id" in sql:
                    return Result({
                        "subscription_id": 42,
                        "desired_action": "subscribe",
                        "generation": 2,
                        "attempt_count": 0,
                        "email": "listener@example.com",
                    })
                return Result({"subscription_id": 42})

        connection = Connection()
        claimed = MODULE.claim_request(connection, "worker-1")
        self.assertEqual(claimed["subscription_id"], 42)
        self.assertIn("for update of outbox skip locked", connection.calls[0][0])
        self.assertEqual(connection.calls[0][1], (MODULE.MAX_ATTEMPTS,))


if __name__ == "__main__":
    unittest.main()
