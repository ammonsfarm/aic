#!/usr/bin/env python3
"""Apply Postgres migrations for the AIC podcast serving database."""

from __future__ import annotations

import argparse
from pathlib import Path

import psycopg

from scripts.aic_database_env import (
    CANONICAL_AIC_ENV,
    DATABASE_ROUTING_ENV_KEYS,
    DATABASE_ENV_KEYS,
    EXPECTED_DB_HOST,
    EXPECTED_DB_PORT,
    database_dsn,
    load_canonical_aic_env,
)


DEFAULT_MIGRATIONS = Path("postgres/migrations")
def load_env(path: Path, *, allow_test_path: bool = False) -> None:
    load_canonical_aic_env(path, allow_test_path=allow_test_path)


def validate_database_target() -> None:
    # database_dsn performs the authoritative five-key and exact-target checks.
    database_dsn(application_name="aic-migration-validation")


def dsn() -> str:
    return database_dsn(application_name="aic-postgres-migrations")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Apply AIC podcast Postgres migrations.")
    parser.add_argument("--env-file", type=Path, default=CANONICAL_AIC_ENV)
    parser.add_argument("--migrations-dir", type=Path, default=DEFAULT_MIGRATIONS)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_env(args.env_file)
    connection_dsn = dsn()
    migration_files = sorted(args.migrations_dir.glob("*.sql"))
    if not migration_files:
        raise SystemExit(f"No migrations found in {args.migrations_dir}")

    with psycopg.connect(connection_dsn, autocommit=True) as conn:
        conn.execute(
            """
            create table if not exists schema_migrations (
                filename text primary key,
                applied_at timestamptz not null default now()
            )
            """
        )
        applied = {row[0] for row in conn.execute("select filename from schema_migrations")}
        for path in migration_files:
            if path.name in applied:
                print(f"skipped {path.name}")
                continue
            print(f"applying {path.name}")
            conn.execute(path.read_text())
            conn.execute("insert into schema_migrations(filename) values (%s)", (path.name,))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
