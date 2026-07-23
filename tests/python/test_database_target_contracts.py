from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER_DATABASE_SCRIPTS = (
    "sync_sqlite_to_postgres.py",
    "sync_podtrac_to_postgres.py",
    "sync_transcript_segments_to_postgres.py",
    "scripts/sync_pastorwood_posts.py",
    "scripts/summarize_pastorwood_posts.py",
    "scripts/vectorize_pastorwood_posts.py",
    "scripts/apply_transcript_edit_requests.py",
)


def load_mac_podtrac_module():
    path = REPO_ROOT / "ops/podtrac/run_daily_podtrac_ingest.py"
    spec = importlib.util.spec_from_file_location("contract_mac_podtrac", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    with patch.dict(
        sys.modules,
        {"psycopg": types.ModuleType("psycopg"), "contract_mac_podtrac": module},
    ):
        spec.loader.exec_module(module)
    return module


class DatabaseTargetContractTests(unittest.TestCase):
    def test_server_sync_scripts_use_the_shared_canonical_database_loader(self) -> None:
        for relative_path in SERVER_DATABASE_SCRIPTS:
            with self.subTest(path=relative_path):
                source = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
                self.assertIn("load_canonical_aic_env(path)", source)
                self.assertIn("database_dsn(application_name=", source)
                self.assertIn("default=CANONICAL_AIC_ENV", source)
                self.assertNotIn("os.environ.setdefault(key.strip()", source)

    def test_mac_podtrac_declared_env_is_authoritative_and_exact(self) -> None:
        module = load_mac_podtrac_module()
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text(
                "DB_HOST=192.168.1.106\n"
                "DB_PORT=5432\n"
                "DB_NAME=aic\n"
                "DB_USER=aic_user\n"
                "DB_PASSWORD=canonical-password\n"
                "PODTRAC_OPTION=from-file\n",
                encoding="utf-8",
            )
            hostile = {
                "DB_HOST": "127.0.0.1",
                "DB_PORT": "6543",
                "DB_NAME": "copied_database",
                "DB_USER": "wrong_user",
                "DB_PASSWORD": "wrong_password",
                "PGHOSTADDR": "127.0.0.1",
                "PGSERVICE": "wrong-service",
                "PGSERVICEFILE": "/tmp/wrong-pg-service",
                "DATABASE_URL": "postgresql://wrong-target.invalid/copied_database",
            }
            with patch.dict(os.environ, hostile, clear=True):
                module.load_env(env_file)
                self.assertEqual(os.environ["DB_HOST"], "192.168.1.106")
                self.assertEqual(os.environ["DB_PORT"], "5432")
                self.assertEqual(os.environ["DB_NAME"], "aic")
                self.assertEqual(os.environ["DB_USER"], "aic_user")
                self.assertEqual(os.environ["DB_PASSWORD"], "canonical-password")
                self.assertEqual(os.environ["PODTRAC_OPTION"], "from-file")
                for key in module.DATABASE_ROUTING_ENV_KEYS:
                    self.assertNotIn(key, os.environ)
                self.assertIn("host='192.168.1.106' port='5432' dbname='aic'", module.dsn())

    def test_mac_podtrac_rejects_a_different_declared_target(self) -> None:
        module = load_mac_podtrac_module()
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text(
                "DB_HOST=127.0.0.1\n"
                "DB_PORT=5432\n"
                "DB_NAME=aic\n"
                "DB_USER=aic_user\n"
                "DB_PASSWORD=test-only\n",
                encoding="utf-8",
            )
            with patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(RuntimeError, r"192\.168\.1\.106:5432"):
                    module.load_env(env_file)

    def test_mac_podtrac_rejects_a_duplicate_sensitive_database_key(self) -> None:
        module = load_mac_podtrac_module()
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text(
                "DB_HOST=192.168.1.106\n"
                "DB_PORT=5432\n"
                "DB_NAME=aic\n"
                "DB_USER=aic_user\n"
                "DB_PASSWORD=test-only\n"
                "DB_NAME=alternate_database\n",
                encoding="utf-8",
            )
            with patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(RuntimeError, r"duplicate sensitive key: DB_NAME"):
                    module.load_env(env_file)


if __name__ == "__main__":
    unittest.main()
