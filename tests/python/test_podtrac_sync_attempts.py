from __future__ import annotations

import argparse
from contextlib import redirect_stdout
from datetime import date
import importlib.util
import io
from pathlib import Path
import sys
import types
import unittest
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "ops" / "podtrac" / "run_daily_podtrac_ingest.py"
PSYCOPG_STUB = types.ModuleType("psycopg")
PSYCOPG_STUB.Connection = object
PSYCOPG_STUB.OperationalError = RuntimeError
sys.modules.setdefault("psycopg", PSYCOPG_STUB)
SPEC = importlib.util.spec_from_file_location("podtrac_sync_attempt_worker", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rowcount = 1
        self._row = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params=()):
        statement = " ".join(str(sql).split())
        self.connection.events.append((self.connection.label, "execute", statement, params))
        if statement.startswith("insert into podtrac_sync_runs"):
            self._row = (71,)
        return self

    def fetchone(self):
        return self._row


class FakeConnection:
    def __init__(self, label, events):
        self.label = label
        self.events = events

    def __enter__(self):
        self.events.append((self.label, "enter"))
        return self

    def __exit__(self, *_args):
        self.events.append((self.label, "exit"))
        return False

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.events.append((self.label, "commit"))

    def rollback(self):
        self.events.append((self.label, "rollback"))


def args(*, dry_run=False):
    return argparse.Namespace(
        env_file=Path("/test/aic.env"),
        curl_file=Path("/test/podtrac-auth.curl"),
        log_dir=Path("/test/logs"),
        auth_mode="curl",
        start=None,
        end=None,
        available_lag_days=1,
        lookback_days=7,
        max_window_days=45,
        batch_size=1000,
        sleep=0,
        fuzzy_threshold=0.91,
        db_connect_retries=1,
        db_connect_timeout=1,
        db_connect_sleep=0,
        dry_run=dry_run,
        server_admin_mode=False,
    )


def empty_payload(report):
    return MODULE.ReportPayload(
        report=report,
        matrix={"totalRows": 0, "rowWindowCount": 0},
        row_totals=[],
        cells={},
    )


class PodtracSyncAttemptTests(unittest.TestCase):
    def test_prefetch_auth_failure_is_committed_as_one_safe_attempt(self):
        events = []
        connections = [
            FakeConnection("window", events),
            FakeConnection("attempt", events),
            FakeConnection("failure", events),
        ]

        def fail_fetch(*_args, **_kwargs):
            events.append(("provider", "fetch"))
            raise MODULE.PodtracAuthenticationError(401)

        with (
            mock.patch.object(MODULE, "load_env"),
            mock.patch.object(MODULE, "connect_pg", side_effect=connections),
            mock.patch.object(MODULE, "choose_window", return_value=(date(2026, 7, 1), date(2026, 7, 29))),
            mock.patch.object(MODULE, "parse_headers_from_curl", return_value={"Cookie": "secret-cookie"}),
            mock.patch.object(MODULE, "fetch_report", side_effect=fail_fetch),
        ):
            with self.assertRaises(MODULE.PodtracAuthenticationError):
                MODULE.run(args())

        inserts = [event for event in events if len(event) > 2 and "insert into podtrac_sync_runs" in event[2]]
        self.assertEqual(len(inserts), 1)
        self.assertEqual(inserts[0][3], ("direct-podtrac-api:2026-07-01:2026-07-29",))
        self.assertLess(events.index(("attempt", "commit")), events.index(("provider", "fetch")))
        failure = next(event for event in events if len(event) > 2 and "status='failed'" in event[2])
        self.assertEqual(failure[3], ("Podtrac authentication failed with HTTP 401.", 71))
        self.assertNotIn("secret-cookie", repr(events))
        self.assertIn(("failure", "commit"), events)

    def test_upsert_failure_rolls_back_then_commits_sanitized_failure_separately(self):
        events = []
        connections = [
            FakeConnection("window", events),
            FakeConnection("attempt", events),
            FakeConnection("import", events),
            FakeConnection("failure", events),
        ]

        def fetch(report, *_args, **_kwargs):
            return empty_payload(report)

        def fail_upsert(*_args, **_kwargs):
            events.append(("import", "upsert"))
            raise RuntimeError("password=database-secret Cookie=provider-secret")

        with (
            mock.patch.object(MODULE, "load_env"),
            mock.patch.object(MODULE, "connect_pg", side_effect=connections),
            mock.patch.object(MODULE, "choose_window", return_value=(date(2026, 7, 1), date(2026, 7, 29))),
            mock.patch.object(MODULE, "parse_headers_from_curl", return_value={"Cookie": "provider-secret"}),
            mock.patch.object(MODULE, "fetch_report", side_effect=fetch),
            mock.patch.object(MODULE, "upsert_podtrac", side_effect=fail_upsert),
        ):
            with self.assertRaisesRegex(RuntimeError, "database-secret"):
                MODULE.run(args())

        self.assertEqual(
            len([event for event in events if len(event) > 2 and "insert into podtrac_sync_runs" in event[2]]),
            1,
        )
        self.assertIn(("import", "rollback"), events)
        self.assertLess(events.index(("import", "rollback")), events.index(("failure", "commit")))
        failure = next(event for event in events if len(event) > 2 and "status='failed'" in event[2])
        self.assertEqual(failure[3], ("Podtrac database import failed (RuntimeError).", 71))
        self.assertNotIn("database-secret", repr(failure))
        self.assertNotIn("provider-secret", repr(failure))

    def test_dry_run_fetches_without_creating_or_updating_attempt_rows(self):
        events = []
        connections = [FakeConnection("window", events)]

        with (
            mock.patch.object(MODULE, "load_env"),
            mock.patch.object(MODULE, "connect_pg", side_effect=connections) as connect,
            mock.patch.object(MODULE, "choose_window", return_value=(date(2026, 7, 1), date(2026, 7, 29))),
            mock.patch.object(MODULE, "parse_headers_from_curl", return_value={"Cookie": "provider-secret"}),
            mock.patch.object(MODULE, "fetch_report", side_effect=lambda report, *_args, **_kwargs: empty_payload(report)),
            redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(MODULE.run(args(dry_run=True)), 0)

        connect.assert_called_once()
        self.assertFalse(any(len(event) > 2 and "podtrac_sync_runs" in event[2] for event in events))
        self.assertFalse(any(event[1] in {"commit", "rollback"} for event in events))


if __name__ == "__main__":
    unittest.main()
