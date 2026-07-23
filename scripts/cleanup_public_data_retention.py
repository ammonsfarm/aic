#!/usr/bin/env python3
"""Delete bounded batches of public-form data past documented retention."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg

try:
    from scripts.aic_database_env import database_dsn, load_canonical_aic_env
except ModuleNotFoundError:  # Direct execution from /mnt/storage/aic/scripts.
    from aic_database_env import database_dsn, load_canonical_aic_env


DEFAULT_ENV_FILE = Path("/mnt/storage/aic/.env")
DEFAULT_BATCH_SIZE = 500
DEFAULT_MAX_BATCHES = 20
SUBSCRIPTION_ATTEMPT_RETENTION_DAYS = 30
CONTACT_ATTEMPT_RETENTION_DAYS = 30
CONTACT_ARCHIVED_RETENTION_DAYS = 365


@dataclass(frozen=True)
class RetentionTarget:
    name: str
    retention_days: int
    statement: str


RETENTION_TARGETS = (
    RetentionTarget(
        "subscription_attempts",
        SUBSCRIPTION_ATTEMPT_RETENTION_DAYS,
        """
        with expired as (
          select id
          from public_subscription_attempts
          where created_at < now() - make_interval(days => %s)
          order by created_at asc, id asc
          for update skip locked
          limit %s
        ), deleted as (
          delete from public_subscription_attempts attempts
          using expired
          where attempts.id = expired.id
          returning attempts.id
        )
        select count(*)::bigint from deleted
        """,
    ),
    RetentionTarget(
        "contact_attempts",
        CONTACT_ATTEMPT_RETENTION_DAYS,
        """
        with expired as (
          select id
          from public_contact_attempts
          where created_at < now() - make_interval(days => %s)
          order by created_at asc, id asc
          for update skip locked
          limit %s
        ), deleted as (
          delete from public_contact_attempts attempts
          using expired
          where attempts.id = expired.id
          returning attempts.id
        )
        select count(*)::bigint from deleted
        """,
    ),
    RetentionTarget(
        "archived_contact_messages",
        CONTACT_ARCHIVED_RETENTION_DAYS,
        """
        with expired as (
          select id
          from public_contact_messages
          where status = 'archived'
            and updated_at < now() - make_interval(days => %s)
          order by updated_at asc, id asc
          for update skip locked
          limit %s
        ), deleted as (
          delete from public_contact_messages messages
          using expired
          where messages.id = expired.id
          returning messages.id
        )
        select count(*)::bigint from deleted
        """,
    ),
)


def bounded_integer(value: int, name: str, minimum: int, maximum: int) -> int:
    if value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}.")
    return value


def run_retention_cleanup(
    connection: Any,
    *,
    batch_size: int = DEFAULT_BATCH_SIZE,
    max_batches: int = DEFAULT_MAX_BATCHES,
) -> dict[str, int]:
    batch_size = bounded_integer(batch_size, "batch size", 1, 5_000)
    max_batches = bounded_integer(max_batches, "max batches", 1, 100)
    totals: dict[str, int] = {}
    for target in RETENTION_TARGETS:
        deleted_total = 0
        for _batch in range(max_batches):
            with connection.transaction():
                row = connection.execute(
                    target.statement,
                    (target.retention_days, batch_size),
                ).fetchone()
            deleted = int(row[0] if row else 0)
            if deleted < 0 or deleted > batch_size:
                raise RuntimeError(f"Retention cleanup returned an invalid count for {target.name}.")
            deleted_total += deleted
            if deleted < batch_size:
                break
        totals[target.name] = deleted_total
    return totals


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Apply bounded public-data retention cleanup.")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--max-batches", type=int, default=DEFAULT_MAX_BATCHES)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    batch_size = bounded_integer(args.batch_size, "batch size", 1, 5_000)
    max_batches = bounded_integer(args.max_batches, "max batches", 1, 100)
    load_canonical_aic_env(args.env_file)
    with psycopg.connect(database_dsn(application_name="aic-public-data-retention")) as connection:
        totals = run_retention_cleanup(
            connection,
            batch_size=batch_size,
            max_batches=max_batches,
        )
    print(" ".join(f"{name}={totals[name]}" for name in sorted(totals)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
