from __future__ import annotations

import importlib.util
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

SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "process_admin_operation_requests.py"
SPEC = importlib.util.spec_from_file_location("process_admin_operation_requests", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class AdminOperationWorkerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.web_root = Path("/srv/aic")
        self.podcast_root = Path("/srv/podcast")
        self.web_python = self.web_root / "python"
        self.podcast_python = self.podcast_root / "python"

    def build(self, stage: str):
        return MODULE.build_command(
            stage,
            Path("/srv/aic/.env"),
            web_root=self.web_root,
            podcast_root=self.podcast_root,
            web_python=self.web_python,
            podcast_python=self.podcast_python,
        )

    def test_commands_are_fixed_argument_arrays(self) -> None:
        command, cwd, timeout = self.build("podtrac-import")
        self.assertEqual(
            command,
            [
                "/usr/bin/flock",
                "-n",
                "/tmp/aic_podtrac_ingest.lock",
                "/srv/aic/python",
                "-u",
                "/srv/aic/ops/podtrac/run_daily_podtrac_ingest.py",
                "--server-admin-mode",
                "--env-file",
                "/srv/aic/.env",
                "--auth-mode",
                "curl",
                "--curl-file",
                "/srv/podcast/podtrac-auth.curl",
                "--log-dir",
                "/srv/podcast/run_logs",
            ],
        )
        self.assertEqual(cwd, Path("/srv/podcast"))
        self.assertGreater(timeout, 0)

        daily, daily_cwd, _timeout = self.build("daily-ingest")
        self.assertEqual(daily[:6], [
            "/srv/podcast/python",
            "/srv/podcast/run_daily_podcast_ingest.py",
            "--env-file",
            "/srv/aic/.env",
            "--workspace",
            "/srv/podcast",
        ])
        self.assertEqual(daily_cwd, Path("/srv/podcast"))
        self.assertNotIn("/srv/podcast/.env", daily)
        self.assertNotIn("run_podtrac_daily_server.sh", command)

    def test_subprocess_receives_only_the_prebuilt_canonical_environment(self) -> None:
        completed = mock.Mock(returncode=0, stdout="ok", stderr="")
        child_env = {
            "DB_HOST": "192.168.1.106",
            "DB_PORT": "5432",
            "DB_NAME": "aic",
            "DB_USER": "aic_user",
            "DB_PASSWORD": "canonical",
            "MISTRAL_API_KEY": "provider-setting",
        }
        with (
            mock.patch.object(MODULE, "build_command", return_value=(["/fixed/runner"], Path("/fixed"), 30)),
            mock.patch.object(MODULE.subprocess, "run", return_value=completed) as run,
        ):
            result = MODULE.run_request({"stage": "daily-ingest"}, Path("/mnt/storage/aic/.env"), child_env)
        self.assertEqual(result, (0, "ok"))
        self.assertEqual(run.call_args.kwargs["env"], child_env)
        self.assertFalse(run.call_args.kwargs["shell"])

    def test_daily_followups_are_fixed_bounded_commands(self) -> None:
        followups = MODULE.build_daily_followup_commands(
            Path("/srv/aic/.env"),
            Path("/srv/podcast/.env"),
            web_root=self.web_root,
            web_python=self.web_python,
        )
        self.assertEqual([label for label, _command, _cwd, _timeout in followups], [
            "canonical-episode-draft-sync",
            "episode-intelligence-recovery",
        ])
        sync = followups[0][1]
        self.assertEqual(sync[:4], [
            "/srv/aic/python",
            "/srv/aic/scripts/sync_canonical_episode_drafts.py",
            "--env-file",
            "/srv/aic/.env",
        ])
        self.assertIn("--apply", sync)
        self.assertEqual(sync[-2:], ["--confirm", "CREATE_MISSING_CANONICAL_EPISODE_DRAFTS"])
        recovery = followups[1][1]
        self.assertEqual(recovery[:4], [
            "/srv/aic/python",
            "/srv/aic/scripts/recover_failed_episode_intelligence.py",
            "--env-file",
            "/srv/aic/.env",
        ])
        self.assertEqual(recovery[recovery.index("--podcast-env-file") + 1], "/srv/podcast/.env")
        self.assertEqual(recovery[-2:], ["--max-candidates", "4"])
        self.assertTrue(all(timeout > 0 for _label, _command, _cwd, timeout in followups))

    def test_daily_followups_attempt_both_and_return_nonzero_on_any_failure(self) -> None:
        calls = []

        def runner(command, **kwargs):
            calls.append((command, kwargs))
            return mock.Mock(
                returncode=7 if command[1].endswith("sync_canonical_episode_drafts.py") else 0,
                stdout="safe output",
                stderr="",
            )

        return_code, output = MODULE.run_daily_followups(
            Path("/mnt/storage/aic/.env"),
            Path("/mnt/storage/aic_podcast/.env"),
            {"PATH": "/fixed"},
            runner=runner,
        )

        self.assertEqual(return_code, 7)
        self.assertEqual(len(calls), 2)
        self.assertIn("canonical-episode-draft-sync", output)
        self.assertIn("episode-intelligence-recovery", output)
        for _command, kwargs in calls:
            self.assertFalse(kwargs["shell"])
            self.assertEqual(kwargs["env"], {"PATH": "/fixed"})

    def test_scheduled_daily_ingest_runs_followups_only_after_success(self) -> None:
        args = mock.Mock(
            env_file=Path("/mnt/storage/aic/.env"),
            podcast_env_file=Path("/mnt/storage/aic_podcast/.env"),
            limit=1,
            scheduled_stage="daily-ingest",
        )
        with (
            mock.patch.object(MODULE, "parse_args", return_value=args),
            mock.patch.object(MODULE, "validate_production_runtime"),
            mock.patch.object(MODULE, "load_env", return_value={"DB_HOST": "192.168.1.106"}),
            mock.patch.object(MODULE, "load_supplemental_podcast_env", return_value={}),
            mock.patch.object(MODULE, "canonical_subprocess_env", return_value={"PATH": "/fixed"}),
            mock.patch.object(MODULE, "run_request", return_value=(0, "ingest ok")),
            mock.patch.object(MODULE, "run_daily_followups", return_value=(0, "followups ok")) as followups,
            mock.patch("builtins.print"),
        ):
            self.assertEqual(MODULE.main(), 0)
        followups.assert_called_once_with(args.env_file, args.podcast_env_file, {"PATH": "/fixed"})

        with (
            mock.patch.object(MODULE, "parse_args", return_value=args),
            mock.patch.object(MODULE, "validate_production_runtime"),
            mock.patch.object(MODULE, "load_env", return_value={}),
            mock.patch.object(MODULE, "load_supplemental_podcast_env", return_value={}),
            mock.patch.object(MODULE, "canonical_subprocess_env", return_value={}),
            mock.patch.object(MODULE, "run_request", return_value=(1, "ingest failed")),
            mock.patch.object(MODULE, "run_daily_followups") as followups,
            mock.patch("builtins.print"),
        ):
            self.assertEqual(MODULE.main(), 1)
        followups.assert_not_called()

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
