from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import sys
import types
import unittest


PSYCOPG_STUB = types.ModuleType("psycopg")
PSYCOPG_STUB.Connection = object
PSYCOPG_ROWS_STUB = types.ModuleType("psycopg.rows")
PSYCOPG_ROWS_STUB.dict_row = object()
sys.modules.setdefault("psycopg", PSYCOPG_STUB)
sys.modules.setdefault("psycopg.rows", PSYCOPG_ROWS_STUB)

SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "process_admin_operation_requests.py"
SPEC = importlib.util.spec_from_file_location("process_admin_operation_requests", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class AdminOperationWorkerTests(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["AIC_WEB_ROOT"] = "/srv/aic"
        os.environ["AIC_PODCAST_ROOT"] = "/srv/podcast"
        os.environ["AIC_WEB_PYTHON"] = "/srv/aic/python"
        os.environ["AIC_PODCAST_PYTHON"] = "/srv/podcast/python"

    def test_commands_are_fixed_argument_arrays(self) -> None:
        command, cwd, timeout = MODULE.build_command("podtrac-import", Path("/srv/aic/.env"))
        self.assertEqual(
            command,
            [
                "/usr/bin/flock",
                "-n",
                "/tmp/aic_podtrac_ingest.lock",
                "/usr/bin/bash",
                "/srv/podcast/scripts/run_podtrac_daily_server.sh",
            ],
        )
        self.assertEqual(cwd, Path("/srv/podcast"))
        self.assertGreater(timeout, 0)

    def test_unknown_stage_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            MODULE.build_command("touch /tmp/owned")

    def test_recovery_waits_past_each_runner_timeout(self) -> None:
        self.assertEqual(MODULE.stale_after_seconds("daily-ingest"), 7_500)
        self.assertEqual(MODULE.stale_after_seconds("podtrac-import"), 2_100)
        self.assertEqual(MODULE.stale_after_seconds("transcript-edits"), 1_200)
        with self.assertRaises(ValueError):
            MODULE.stale_after_seconds("not-allowlisted")

    def test_output_redacts_credentials(self) -> None:
        clean = MODULE.safe_output("Authorization: bearer-value password=hunter2 token=abc123")
        self.assertNotIn("bearer-value", clean)
        self.assertNotIn("hunter2", clean)
        self.assertNotIn("abc123", clean)
        self.assertIn("[redacted]", clean)

    def test_stale_running_request_is_failed_and_audited(self) -> None:
        class Result:
            def __init__(self, rows):
                self._rows = rows

            def fetchall(self):
                return self._rows

        class Transaction:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        class Connection:
            def __init__(self):
                self.calls = []

            def transaction(self):
                return Transaction()

            def execute(self, sql, params):
                self.calls.append((sql, params))
                if "update pipeline_retry_requests" in sql and params[0] == "podtrac-import":
                    return Result([{"id": 9, "stage": "podtrac-import", "requested_by": "admin@example.com", "recovery_count": 1}])
                return Result([])

        connection = Connection()
        recovered = MODULE.recover_stale_requests(connection)

        self.assertEqual(recovered[0]["id"], 9)
        update_calls = [(sql, params) for sql, params in connection.calls if "update pipeline_retry_requests" in sql]
        self.assertEqual([params[0] for _sql, params in update_calls], list(MODULE.STAGE_TIMEOUT_SECONDS))
        self.assertEqual(update_calls[1][1], ("podtrac-import", 2_100))
        audit_sql, audit_params = next((sql, params) for sql, params in connection.calls if "pipeline_retry_recovered" in sql)
        self.assertIn("admin_operation_audit", audit_sql)
        self.assertEqual(audit_params[:3], ("9", "podtrac-import", 1))

    def test_stale_worker_cannot_complete_or_emit_terminal_audit(self) -> None:
        class Result:
            def __init__(self, row=None):
                self._row = row

            def fetchone(self):
                return self._row

        class Transaction:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

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
            {"id": 9, "stage": "podtrac-import"},
            worker_id="stale-worker",
            return_code=0,
            output="done",
        )

        self.assertFalse(completed)
        self.assertEqual(len(connection.calls), 1)
        update_sql, update_params = connection.calls[0]
        self.assertIn("worker_id = %s", update_sql)
        self.assertIn("returning id", update_sql)
        self.assertEqual(update_params[-1], "stale-worker")


if __name__ == "__main__":
    unittest.main()
