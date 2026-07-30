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


def load_database_env_module():
    path = REPO_ROOT / "scripts/aic_database_env.py"
    spec = importlib.util.spec_from_file_location("contract_aic_database_env", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def canonical_env_text() -> str:
    return (
        "DB_HOST=192.168.1.106\n"
        "DB_PORT=5432\n"
        "DB_NAME=aic\n"
        "DB_USER=aic_user\n"
        "DB_PASSWORD=canonical-password\n"
    )


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
                "PGOPTIONS": "-c search_path=wrong",
                "PGUNEXPECTEDROUTE": "wrong",
                "PATH": "/tmp/hostile-bin",
                "PYTHONPATH": "/tmp/hostile-python",
                "LD_PRELOAD": "/tmp/hostile.so",
                "STRAPI_URL": "https://hostile.invalid",
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
                self.assertNotIn("PGUNEXPECTEDROUTE", os.environ)
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

    def test_canonical_worker_child_env_ignores_hostile_inherited_routing_and_keeps_providers(self) -> None:
        module = load_database_env_module()
        with tempfile.TemporaryDirectory() as directory:
            canonical_file = Path(directory) / "aic.env"
            supplemental_file = Path(directory) / "podcast.env"
            canonical_file.write_text(canonical_env_text(), encoding="utf-8")
            supplemental_file.write_text(
                canonical_env_text()
                + "MISTRAL_API_KEY=provider-key\n"
                + "OPENAI_SESSION_TOKEN=provider-token\n"
                + "RAG_CHAT_APP_TOKEN=known-but-not-needed-by-ingest\n",
                encoding="utf-8",
            )
            hostile = {
                "DB_HOST": "203.0.113.55",
                "DB_PORT": "6543",
                "DB_NAME": "copied_database",
                "DB_USER": "wrong_user",
                "DB_PASSWORD": "wrong_password",
                "DATABASE_URL": "postgresql://wrong.invalid/copied_database",
                "PGHOST": "wrong.invalid",
                "PGPORT": "6543",
                "PGDATABASE": "copied_database",
                "PGUSER": "wrong_user",
                "PGPASSWORD": "wrong_password",
                "PGOPTIONS": "-c search_path=wrong",
                "PGUNEXPECTEDROUTE": "wrong",
            }
            with patch.dict(os.environ, hostile, clear=True):
                canonical = module.load_canonical_aic_env(canonical_file, allow_test_path=True)
                supplemental = module.load_supplemental_podcast_env(
                    supplemental_file,
                    canonical_values=canonical,
                    allow_test_path=True,
                )
                child = module.canonical_subprocess_env(canonical, supplemental)

            self.assertEqual(
                {key: child[key] for key in module.DATABASE_ENV_KEYS},
                {
                    "DB_HOST": "192.168.1.106",
                    "DB_PORT": "5432",
                    "DB_NAME": "aic",
                    "DB_USER": "aic_user",
                    "DB_PASSWORD": "canonical-password",
                },
            )
            self.assertEqual(child["MISTRAL_API_KEY"], "provider-key")
            self.assertEqual(child["OPENAI_SESSION_TOKEN"], "provider-token")
            self.assertNotIn("RAG_CHAT_APP_TOKEN", child)
            self.assertFalse(any(key == "DATABASE_URL" or key.startswith("PG") for key in child))
            self.assertEqual(child["PATH"], module.SAFE_SUBPROCESS_PATH)
            self.assertNotIn("PYTHONPATH", child)
            self.assertNotIn("LD_PRELOAD", child)
            self.assertNotIn("STRAPI_URL", child)

    def test_contact_email_provider_values_are_file_authoritative_and_clear_inherited_state(self) -> None:
        module = load_database_env_module()
        provider = (
            "CONTACT_EMAIL_DELIVERY_ENABLED=true\n"
            "CONTACT_EMAIL_SMTP_HOST=smtp.example.org\n"
            "CONTACT_EMAIL_SMTP_PORT=587\n"
            "CONTACT_EMAIL_SMTP_USERNAME=canonical-user\n"
            "CONTACT_EMAIL_SMTP_PASSWORD=canonical-password-value\n"
            "CONTACT_EMAIL_SMTP_STARTTLS=true\n"
            "CONTACT_EMAIL_FROM=contact@example.org\n"
            "CONTACT_EMAIL_TO=office@example.org\n"
        )
        hostile = {
            key: "inherited-value"
            for key in module.CONTACT_EMAIL_PROVIDER_ENV_KEYS
        }
        hostile.update({
            "DATABASE_URL": "postgresql://wrong.invalid/copied_database",
            "PGHOST": "wrong.invalid",
        })
        with tempfile.TemporaryDirectory() as directory:
            canonical_file = Path(directory) / "aic.env"
            canonical_file.write_text(canonical_env_text() + provider, encoding="utf-8")
            with patch.dict(os.environ, hostile, clear=True):
                values = module.load_canonical_aic_env(canonical_file, allow_test_path=True)
                self.assertEqual(os.environ["CONTACT_EMAIL_SMTP_HOST"], "smtp.example.org")
                self.assertEqual(os.environ["CONTACT_EMAIL_SMTP_USERNAME"], "canonical-user")
                self.assertEqual(os.environ["CONTACT_EMAIL_SMTP_PASSWORD"], "canonical-password-value")
                self.assertEqual(values["CONTACT_EMAIL_TO"], "office@example.org")
                self.assertFalse(any(key == "DATABASE_URL" or key.startswith("PG") for key in os.environ))

    def test_duplicate_contact_provider_secret_is_rejected(self) -> None:
        module = load_database_env_module()
        with tempfile.TemporaryDirectory() as directory:
            canonical_file = Path(directory) / "aic.env"
            canonical_file.write_text(
                canonical_env_text()
                + "CONTACT_EMAIL_DELIVERY_ENABLED=false\n"
                + "CONTACT_EMAIL_SMTP_PASSWORD=one\n"
                + "CONTACT_EMAIL_SMTP_PASSWORD=two\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "duplicate sensitive key: CONTACT_EMAIL_SMTP_PASSWORD"):
                module.load_canonical_aic_env(canonical_file, allow_test_path=True)

    def test_supplemental_podcast_env_cannot_become_a_database_authority(self) -> None:
        module = load_database_env_module()
        canonical = {
            "DB_HOST": "192.168.1.106",
            "DB_PORT": "5432",
            "DB_NAME": "aic",
            "DB_USER": "aic_user",
            "DB_PASSWORD": "canonical-password",
        }
        cases = {
            "mismatched legacy DB value": canonical_env_text().replace("DB_NAME=aic\n", "DB_NAME=copy\n"),
            "database URL": canonical_env_text() + "DATABASE_URL=postgresql://wrong.invalid/copy\n",
            "unexpected PG key": canonical_env_text() + "PGUNEXPECTEDROUTE=wrong\n",
            "duplicate provider secret": canonical_env_text() + "MISTRAL_API_KEY=one\nMISTRAL_API_KEY=two\n",
            "hostile path": canonical_env_text() + "PATH=/tmp/hostile\n",
            "hostile python path": canonical_env_text() + "PYTHONPATH=/tmp/hostile\n",
            "hostile Strapi endpoint": canonical_env_text() + "STRAPI_URL=https://hostile.invalid\n",
            "unexpected provider secret": canonical_env_text() + "SURPRISE_API_KEY=hostile\n",
        }
        with tempfile.TemporaryDirectory() as directory:
            for name, content in cases.items():
                with self.subTest(name=name):
                    path = Path(directory) / name.replace(" ", "-")
                    path.write_text(content, encoding="utf-8")
                    with self.assertRaises(RuntimeError):
                        module.load_supplemental_podcast_env(
                            path,
                            canonical_values=canonical,
                            allow_test_path=True,
                        )

    def test_canonical_worker_env_rejects_declared_database_routing(self) -> None:
        module = load_database_env_module()
        with tempfile.TemporaryDirectory() as directory:
            for key in ("DATABASE_URL", "PGHOST", "PGOPTIONS", "PGUNEXPECTEDROUTE"):
                with self.subTest(key=key):
                    path = Path(directory) / f"{key}.env"
                    path.write_text(canonical_env_text() + f"{key}=wrong\n", encoding="utf-8")
                    with self.assertRaisesRegex(RuntimeError, "database routing"):
                        module.load_canonical_aic_env(path, allow_test_path=True)


if __name__ == "__main__":
    unittest.main()
