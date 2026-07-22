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

    def test_output_redacts_credentials(self) -> None:
        clean = MODULE.safe_output("Authorization: bearer-value password=hunter2 token=abc123")
        self.assertNotIn("bearer-value", clean)
        self.assertNotIn("hunter2", clean)
        self.assertNotIn("abc123", clean)
        self.assertIn("[redacted]", clean)


if __name__ == "__main__":
    unittest.main()
