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
        }

        with patch.dict(os.environ, inherited, clear=True):
            migrations.load_env(env_file)

            self.assertEqual(os.environ["DB_HOST"], "192.168.1.106")
            self.assertEqual(os.environ["DB_PORT"], "5432")
            self.assertEqual(os.environ["DB_NAME"], "aic")
            self.assertEqual(os.environ["DB_USER"], "aic_user")
            self.assertEqual(os.environ["DB_PASSWORD"], "canonical-password")
            self.assertIn("host=192.168.1.106 port=5432 dbname=aic", migrations.dsn())

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
                    migrations.load_env(env_file)
                    with self.assertRaisesRegex(SystemExit, r"192\.168\.1\.106:5432"):
                        migrations.dsn()

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
            migrations.load_env(env_file)

            self.assertNotIn("DB_NAME", os.environ)
            with self.assertRaisesRegex(SystemExit, r"DB_NAME"):
                migrations.dsn()


if __name__ == "__main__":
    unittest.main()
