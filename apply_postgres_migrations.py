#!/usr/bin/env python3
"""Apply Postgres migrations for the AIC podcast serving database."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import psycopg


DEFAULT_MIGRATIONS = Path("postgres/migrations")
EXPECTED_DB_HOST = "192.168.1.106"
EXPECTED_DB_PORT = "5432"
DATABASE_ENV_KEYS = (
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
)


def load_env(path: Path) -> None:
    # The selected env file is authoritative for database routing. Inherited
    # DB_* values must never repoint migrations away from the existing AIC DB.
    for key in DATABASE_ENV_KEYS:
        os.environ.pop(key, None)

    if not path.exists():
        return
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key in DATABASE_ENV_KEYS:
            os.environ[key] = value
        else:
            os.environ.setdefault(key, value)


def validate_database_target() -> None:
    missing = [key for key in DATABASE_ENV_KEYS if not os.environ.get(key)]
    if missing:
        raise SystemExit(
            "Database migrations require these values from the selected env file: "
            + ", ".join(missing)
        )

    host = os.environ["DB_HOST"]
    port = os.environ["DB_PORT"]
    if host != EXPECTED_DB_HOST or port != EXPECTED_DB_PORT:
        raise SystemExit(
            "Database migrations require the existing AIC PostgreSQL target at "
            f"{EXPECTED_DB_HOST}:{EXPECTED_DB_PORT}; got {host}:{port}"
        )


def dsn() -> str:
    validate_database_target()
    return (
        f"host={os.environ['DB_HOST']} "
        f"port={os.environ['DB_PORT']} "
        f"dbname={os.environ['DB_NAME']} "
        f"user={os.environ['DB_USER']} "
        f"password={os.environ['DB_PASSWORD']}"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Apply AIC podcast Postgres migrations.")
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
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
