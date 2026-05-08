#!/usr/bin/env python3
"""Apply Postgres migrations for the AIC podcast serving database."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import psycopg


DEFAULT_MIGRATIONS = Path("postgres/migrations")


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def dsn() -> str:
    return (
        f"host={os.environ['DB_HOST']} "
        f"port={os.environ.get('DB_PORT', '5432')} "
        f"dbname={os.environ.get('DB_NAME', 'aic')} "
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
    migration_files = sorted(args.migrations_dir.glob("*.sql"))
    if not migration_files:
        raise SystemExit(f"No migrations found in {args.migrations_dir}")

    with psycopg.connect(dsn(), autocommit=True) as conn:
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
