#!/usr/bin/env python3
"""Process allowlisted admin-operation requests outside the web process."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import socket
import subprocess
from typing import Any

import psycopg
from psycopg.rows import dict_row

try:
    from scripts.aic_database_env import database_dsn, load_canonical_aic_env
except ModuleNotFoundError:  # Direct execution from /mnt/storage/aic/scripts.
    from aic_database_env import database_dsn, load_canonical_aic_env


DEFAULT_ENV_FILE = Path("/mnt/storage/aic/.env")
DEFAULT_WEB_ROOT = Path("/mnt/storage/aic")
DEFAULT_PODCAST_ROOT = Path("/mnt/storage/aic_podcast")
STAGE_TIMEOUT_SECONDS = {
    "daily-ingest": 7_200,
    "podtrac-import": 1_800,
    "transcript-edits": 900,
}
RECOVERY_GRACE_SECONDS = 300


def load_env(path: Path) -> None:
    load_canonical_aic_env(path)


def dsn() -> str:
    return database_dsn(application_name="aic-admin-operations-worker")


def build_command(stage: str, env_file: Path = DEFAULT_ENV_FILE) -> tuple[list[str], Path, int]:
    web_root = Path(os.environ.get("AIC_WEB_ROOT", str(DEFAULT_WEB_ROOT)))
    podcast_root = Path(os.environ.get("AIC_PODCAST_ROOT", str(DEFAULT_PODCAST_ROOT)))
    podcast_python = os.environ.get("AIC_PODCAST_PYTHON", str(podcast_root / ".venv-pg/bin/python"))
    web_python = os.environ.get("AIC_WEB_PYTHON", str(web_root / ".venv-pg/bin/python"))

    if stage == "daily-ingest":
        return (
            [
                podcast_python,
                str(podcast_root / "run_daily_podcast_ingest.py"),
                "--transcribe-engine",
                "mistral",
                "--max-tracks",
                "50",
                "--transcribe-workers",
                "4",
                "--intelligence-workers",
                "4",
                "--intelligence-provider",
                "silo",
                "--intelligence-model",
                os.environ.get("AIC_INTELLIGENCE_MODEL", "openai-codex/gpt-5.6-luna"),
                "--intelligence-reasoning-effort",
                "medium",
                "--no-extractive-fallback",
            ],
            podcast_root,
            STAGE_TIMEOUT_SECONDS[stage],
        )
    if stage == "podtrac-import":
        return (
            [
                "/usr/bin/flock",
                "-n",
                "/tmp/aic_podtrac_ingest.lock",
                "/usr/bin/bash",
                str(podcast_root / "scripts/run_podtrac_daily_server.sh"),
            ],
            podcast_root,
            STAGE_TIMEOUT_SECONDS[stage],
        )
    if stage == "transcript-edits":
        return (
            [
                web_python,
                str(web_root / "scripts/apply_transcript_edit_requests.py"),
                "--env-file",
                str(env_file),
                "--limit",
                "25",
            ],
            web_root,
            STAGE_TIMEOUT_SECONDS[stage],
        )
    raise ValueError(f"Unsupported admin operation stage: {stage}")


def stale_after_seconds(stage: str) -> int:
    try:
        return STAGE_TIMEOUT_SECONDS[stage] + RECOVERY_GRACE_SECONDS
    except KeyError as error:
        raise ValueError(f"Unsupported admin operation stage: {stage}") from error


def recover_stale_requests(conn: psycopg.Connection[Any]) -> list[dict[str, Any]]:
    """Fail abandoned running rows after their runner timeout plus a grace period."""
    recovered: list[dict[str, Any]] = []
    for stage in STAGE_TIMEOUT_SECONDS:
        with conn.transaction():
            rows = conn.execute(
                """
                update pipeline_retry_requests
                   set status = 'failed',
                       completed_at = now(),
                       worker_id = '',
                       output_summary = '',
                       error = 'Worker stopped before recording completion; the stale request was recovered.',
                       recovery_count = recovery_count + 1,
                       updated_at = now()
                 where stage = %s
                   and status = 'running'
                   and started_at < now() - make_interval(secs => %s)
                 returning id, stage, requested_by, recovery_count
                """,
                (stage, stale_after_seconds(stage)),
            ).fetchall()
            for row in rows:
                conn.execute(
                    """
                    insert into admin_operation_audit(action, entity_type, entity_id, actor_email, detail_json)
                    values ('pipeline_retry_recovered', 'pipeline_retry_request', %s, 'system-worker',
                            jsonb_build_object('stage', %s, 'recoveryCount', %s,
                                               'previousRequester', %s))
                    """,
                    (str(row["id"]), row["stage"], row["recovery_count"], row["requested_by"]),
                )
                recovered.append(dict(row))
    return recovered


def safe_output(value: str, limit: int = 4_000) -> str:
    redacted = re.sub(
        r"(?i)(authorization|cookie|password|secret|api[_-]?key|token)\s*[:=]\s*[^\s,;]+",
        r"\1=[redacted]",
        value,
    )
    return redacted[-limit:].strip()


def claim_request(conn: psycopg.Connection[Any], worker_id: str) -> dict[str, Any] | None:
    with conn.transaction():
        row = conn.execute(
            """
            select id, stage, source_run_id, reason, requested_by
              from pipeline_retry_requests
             where status = 'queued'
             order by requested_at
             for update skip locked
             limit 1
            """
        ).fetchone()
        if not row:
            return None
        conn.execute(
            """
            update pipeline_retry_requests
               set status = 'running', started_at = now(), worker_id = %s, updated_at = now()
             where id = %s
            """,
            (worker_id, row["id"]),
        )
        conn.execute(
            """
            insert into admin_operation_audit(action, entity_type, entity_id, actor_email, detail_json)
            values ('pipeline_retry_started', 'pipeline_retry_request', %s, 'system-worker',
                    jsonb_build_object('stage', %s, 'workerId', %s))
            """,
            (str(row["id"]), row["stage"], worker_id),
        )
        return dict(row)


def complete_request(
    conn: psycopg.Connection[Any],
    request: dict[str, Any],
    *,
    worker_id: str,
    return_code: int,
    output: str,
) -> bool:
    status = "completed" if return_code == 0 else "failed"
    summary = safe_output(output)
    error = "" if return_code == 0 else summary or f"Allowlisted runner exited with status {return_code}."
    with conn.transaction():
        completed = conn.execute(
            """
            update pipeline_retry_requests
               set status = %s,
                   completed_at = now(),
                   output_summary = %s,
                   error = %s,
                   worker_id = '',
                   updated_at = now()
             where id = %s and status = 'running' and worker_id = %s
             returning id
            """,
            (status, summary if return_code == 0 else "", error, request["id"], worker_id),
        ).fetchone()
        if not completed:
            return False
        conn.execute(
            """
            insert into admin_operation_audit(action, entity_type, entity_id, actor_email, detail_json)
            values (%s, 'pipeline_retry_request', %s, 'system-worker',
                    jsonb_build_object('stage', %s, 'status', %s, 'returnCode', %s))
            """,
            (
                "pipeline_retry_completed" if return_code == 0 else "pipeline_retry_failed",
                str(request["id"]),
                request["stage"],
                status,
                return_code,
            ),
        )
        return True


def run_request(request: dict[str, Any], env_file: Path) -> tuple[int, str]:
    command, cwd, timeout = build_command(request["stage"], env_file)
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            env=os.environ.copy(),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            shell=False,
        )
        output = "\n".join(part for part in (result.stdout, result.stderr) if part)
        return result.returncode, output
    except subprocess.TimeoutExpired as error:
        output = "\n".join(
            part.decode(errors="replace") if isinstance(part, bytes) else part or ""
            for part in (error.stdout, error.stderr)
        )
        return 124, f"Allowlisted runner timed out after {timeout} seconds.\n{output}"
    except Exception as error:  # The queue must record runner launch failures.
        return 126, f"Could not start allowlisted runner: {type(error).__name__}: {error}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Process queued AIC admin operations.")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--limit", type=int, default=1)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_env(args.env_file)
    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    processed = 0
    with psycopg.connect(dsn(), row_factory=dict_row) as conn:
        recovered = recover_stale_requests(conn)
        while processed < max(1, args.limit):
            request = claim_request(conn, worker_id)
            if not request:
                break
            return_code, output = run_request(request, args.env_file)
            complete_request(
                conn,
                request,
                worker_id=worker_id,
                return_code=return_code,
                output=output,
            )
            processed += 1
    print(f"recovered={len(recovered)} processed={processed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
