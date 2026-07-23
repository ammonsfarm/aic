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
MODULE_PATH = REPO_ROOT / "apply_postgres_migrations.py"


def load_migration_module():
    spec = importlib.util.spec_from_file_location("apply_postgres_migrations", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {MODULE_PATH}")

    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {"psycopg": types.ModuleType("psycopg")}):
        spec.loader.exec_module(module)
    return module


migrations = load_migration_module()


class MigrationDatabaseContractTests(unittest.TestCase):
    def env_file(self, contents: str) -> Path:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / ".env"
        path.write_text(contents)
        return path

    def test_selected_env_file_replaces_all_inherited_database_values(self) -> None:
        env_file = self.env_file(
            "\n".join(
                [
                    "DB_HOST=192.168.1.106",
                    "DB_PORT=5432",
                    "DB_NAME=aic",
                    "DB_USER=aic_user",
                    "DB_PASSWORD=canonical-password",
                    "",
                ]
            )
        )
        inherited = {
            "DB_HOST": "127.0.0.1",
            "DB_PORT": "6543",
            "DB_NAME": "copied_database",
            "DB_USER": "inherited_user",
            "DB_PASSWORD": "inherited-password",
            "PGHOST": "wrong-pg-host.invalid",
            "PGHOSTADDR": "127.0.0.1",
            "PGPORT": "6543",
            "PGDATABASE": "copied_database",
            "PGUSER": "inherited_pg_user",
            "PGPASSWORD": "inherited-pg-password",
            "PGPASSFILE": "/tmp/wrong-pg-pass",
            "PGSERVICE": "wrong-service",
            "PGSERVICEFILE": "/tmp/wrong-pg-service",
            "DATABASE_URL": "postgresql://wrong-target.invalid/copied_database",
        }

        with patch.dict(os.environ, inherited, clear=True):
            migrations.load_env(env_file, allow_test_path=True)

            self.assertEqual(os.environ["DB_HOST"], "192.168.1.106")
            self.assertEqual(os.environ["DB_PORT"], "5432")
            self.assertEqual(os.environ["DB_NAME"], "aic")
            self.assertEqual(os.environ["DB_USER"], "aic_user")
            self.assertEqual(os.environ["DB_PASSWORD"], "canonical-password")
            for key in migrations.DATABASE_ROUTING_ENV_KEYS:
                self.assertNotIn(key, os.environ)
            self.assertIn("host='192.168.1.106' port='5432' dbname='aic'", migrations.dsn())
            self.assertIn("connect_timeout='5'", migrations.dsn())

    def test_noncanonical_host_or_port_is_rejected_before_a_dsn_is_returned(self) -> None:
        for host, port in (("127.0.0.1", "5432"), ("192.168.1.106", "5433")):
            with self.subTest(host=host, port=port):
                env_file = self.env_file(
                    "\n".join(
                        [
                            f"DB_HOST={host}",
                            f"DB_PORT={port}",
                            "DB_NAME=aic",
                            "DB_USER=aic_user",
                            "DB_PASSWORD=test-only",
                            "",
                        ]
                    )
                )
                with patch.dict(os.environ, {}, clear=True):
                    with self.assertRaisesRegex(RuntimeError, r"192\.168\.1\.106:5432"):
                        migrations.load_env(env_file, allow_test_path=True)

    def test_duplicate_sensitive_database_key_is_rejected(self) -> None:
        env_file = self.env_file(
            "DB_HOST=192.168.1.106\n"
            "DB_PORT=5432\n"
            "DB_NAME=aic\n"
            "DB_USER=aic\n"
            "DB_PASSWORD=test\n"
            "DB_HOST=127.0.0.1\n"
        )
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, r"duplicate sensitive key: DB_HOST"):
                migrations.load_env(env_file, allow_test_path=True)

    def test_missing_env_file_value_cannot_fall_back_to_inherited_database_value(self) -> None:
        env_file = self.env_file(
            "\n".join(
                [
                    "DB_HOST=192.168.1.106",
                    "DB_PORT=5432",
                    "DB_USER=aic_user",
                    "DB_PASSWORD=test-only",
                    "",
                ]
            )
        )

        with patch.dict(os.environ, {"DB_NAME": "inherited_database"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, r"DB_NAME"):
                migrations.load_env(env_file, allow_test_path=True)

    def test_production_rejects_an_alternate_environment_path(self) -> None:
        env_file = self.env_file(
            "DB_HOST=192.168.1.106\nDB_PORT=5432\nDB_NAME=aic\nDB_USER=aic\nDB_PASSWORD=test\n"
        )
        with self.assertRaisesRegex(RuntimeError, r"/mnt/storage/aic/\.env"):
            migrations.load_env(env_file)

    def test_dsn_rejects_a_routing_override_added_after_canonical_load(self) -> None:
        env_file = self.env_file(
            "DB_HOST=192.168.1.106\nDB_PORT=5432\nDB_NAME=aic\nDB_USER=aic\nDB_PASSWORD=test\n"
        )
        with patch.dict(os.environ, {}, clear=True):
            migrations.load_env(env_file, allow_test_path=True)
            os.environ["PGHOSTADDR"] = "127.0.0.1"
            with self.assertRaisesRegex(RuntimeError, r"PGHOSTADDR"):
                migrations.dsn()


if __name__ == "__main__":
    unittest.main()
