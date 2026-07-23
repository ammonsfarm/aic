#!/usr/bin/env python3
"""Apply queued transcript edits and mark affected RAG chunks for re-vectorizing."""

from __future__ import annotations

import argparse
import json
import os
import socket
import urllib.error
import urllib.request
from pathlib import Path

import psycopg

try:
    from scripts.aic_database_env import CANONICAL_AIC_ENV, database_dsn, load_canonical_aic_env
except ModuleNotFoundError:  # Direct execution from /mnt/storage/aic/scripts.
    from aic_database_env import CANONICAL_AIC_ENV, database_dsn, load_canonical_aic_env


DEFAULT_MAX_ATTEMPTS = 5
DEFAULT_RETRY_BASE_SECONDS = 120
DEFAULT_CLAIM_LEASE_SECONDS = 900


def load_env(path: Path) -> None:
    load_canonical_aic_env(path)


def dsn() -> str:
    return database_dsn(application_name="aic-transcript-edit-worker")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=CANONICAL_AIC_ENV)
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--edit-id", type=int, action="append", default=[])
    parser.add_argument("--embedding-model")
    parser.add_argument("--max-attempts", type=int, default=DEFAULT_MAX_ATTEMPTS)
    parser.add_argument("--retry-base-seconds", type=int, default=DEFAULT_RETRY_BASE_SECONDS)
    parser.add_argument("--claim-lease-seconds", type=int, default=DEFAULT_CLAIM_LEASE_SECONDS)
    parser.add_argument("--skip-revectorize", action="store_true")
    parser.add_argument("--force-retry-terminal", action="store_true")
    parser.add_argument("--retry-actor", default="")
    parser.add_argument("--retry-reason", default="")
    return parser.parse_args()


def retry_delay_seconds(attempt_count: int, base_seconds: int) -> int:
    return min(3_600, max(1, base_seconds) * (2 ** max(0, attempt_count - 1)))


def resolve_embedding_model(explicit_model: str | None) -> str:
    return explicit_model or os.environ.get("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")


def recover_stale_edits(conn: psycopg.Connection, lease_seconds: int, max_attempts: int) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            update transcript_edit_requests
            set status = 'failed',
                processing_error = case
                  when attempt_count >= %s then 'Terminal failure: worker stopped after the final allowed attempt.'
                  else 'Worker stopped before completing this edit; it was released for retry.'
                end,
                next_attempt_at = case when attempt_count >= %s then 'infinity'::timestamptz else now() end,
                claimed_at = null,
                worker_id = '',
                updated_at = now()
            where status = 'applying'
              and (claimed_at is null or claimed_at < now() - make_interval(secs => %s))
            """,
            (max_attempts, max_attempts, lease_seconds),
        )
        return cur.rowcount


def recover_stale_revectorizations(conn: psycopg.Connection, lease_seconds: int, max_attempts: int) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            update transcript_edit_requests
            set processing_error = case
                  when revectorization_attempt_count >= %s
                    then 'Terminal re-vectorization failure: worker stopped after the final allowed attempt.'
                  else 'Re-vectorization worker stopped before completion; the claim was released for retry.'
                end,
                next_revectorization_at = case
                  when revectorization_attempt_count >= %s then 'infinity'::timestamptz
                  else now()
                end,
                revectorization_claimed_at = null,
                revectorization_worker_id = '',
                updated_at = now()
            where status = 'applied'
              and needs_revectorization
              and revectorization_claimed_at is not null
              and revectorization_claimed_at < now() - make_interval(secs => %s)
            """,
            (max_attempts, max_attempts, lease_seconds),
        )
        return cur.rowcount


def reset_terminal_requests(
    conn: psycopg.Connection,
    edit_ids: list[int],
    actor: str,
    reason: str,
) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            with candidates as (
              select id, attempt_count, revectorization_attempt_count, status,
                     next_attempt_at = 'infinity'::timestamptz as edit_terminal,
                     next_revectorization_at = 'infinity'::timestamptz as revectorization_terminal
              from transcript_edit_requests
              where id = any(%s)
                and (
                  next_attempt_at = 'infinity'::timestamptz
                  or next_revectorization_at = 'infinity'::timestamptz
                )
              for update
            ), reset as (
              update transcript_edit_requests r
              set attempt_count = case when c.edit_terminal then 0 else r.attempt_count end,
                  next_attempt_at = case when c.edit_terminal then now() else r.next_attempt_at end,
                  revectorization_attempt_count = case when c.revectorization_terminal then 0 else r.revectorization_attempt_count end,
                  next_revectorization_at = case when c.revectorization_terminal then now() else r.next_revectorization_at end,
                  claimed_at = null,
                  worker_id = '',
                  revectorization_claimed_at = null,
                  revectorization_worker_id = '',
                  processing_error = '',
                  updated_at = now()
              from candidates c
              where r.id = c.id
              returning r.id, c.attempt_count, c.revectorization_attempt_count,
                        c.edit_terminal, c.revectorization_terminal
            )
            insert into admin_operation_audit(action, entity_type, entity_id, actor_email, detail_json)
            select 'transcript_terminal_retry_reset', 'transcript_edit_request', id::text, %s,
                   jsonb_build_object(
                     'reason', %s,
                     'priorAttemptCount', attempt_count,
                     'priorRevectorizationAttemptCount', revectorization_attempt_count,
                     'editTerminal', edit_terminal,
                     'revectorizationTerminal', revectorization_terminal
                   )
            from reset
            """,
            (edit_ids, actor, reason),
        )
        return cur.rowcount


def claim_next_edit(
    conn: psycopg.Connection,
    worker_id: str,
    max_attempts: int,
    edit_ids: list[int],
) -> dict | None:
    if edit_ids:
        sql = """
            with claimed as (
              select id
              from transcript_edit_requests
              where id = any(%s)
                and status in ('pending', 'failed')
                and attempt_count < %s
                and next_attempt_at <= now()
              order by created_at asc, id asc
              limit 1
              for update skip locked
            )
            update transcript_edit_requests r
            set status = 'applying', attempt_count = r.attempt_count + 1,
                claimed_at = now(), worker_id = %s, updated_at = now(), processing_error = ''
            from claimed
            where r.id = claimed.id
            returning
              r.id, r.track_id, r.segment_id, r.source_table, r.source_field,
              r.original_text, r.edited_text, r.attempt_count
        """
        params = (edit_ids, max_attempts, worker_id)
    else:
        sql = """
            with claimed as (
              select id
              from transcript_edit_requests
              where status in ('pending', 'failed')
                and attempt_count < %s
                and next_attempt_at <= now()
              order by created_at asc, id asc
              limit 1
              for update skip locked
            )
            update transcript_edit_requests r
            set status = 'applying', attempt_count = r.attempt_count + 1,
                claimed_at = now(), worker_id = %s, updated_at = now(), processing_error = ''
            from claimed
            where r.id = claimed.id
            returning
              r.id, r.track_id, r.segment_id, r.source_table, r.source_field,
              r.original_text, r.edited_text, r.attempt_count
        """
        params = (max_attempts, worker_id)

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(sql, params)
        rows = list(cur.fetchall())
        return rows[0] if rows else None


def apply_edit(
    conn: psycopg.Connection,
    edit: dict,
    worker_id: str,
    claim_revectorization: bool,
) -> tuple[int, list[str]]:
    original = edit["original_text"]
    edited = edit["edited_text"]
    track_id = edit["track_id"]
    segment_id = edit["segment_id"]

    with conn.cursor() as cur:
        cur.execute(
            """
            select id
            from transcript_edit_requests
            where id = %s and status = 'applying' and worker_id = %s
            for update
            """,
            (edit["id"], worker_id),
        )
        if not cur.fetchone():
            raise RuntimeError("Transcript edit claim is no longer owned by this worker.")
        segment_updates = 0
        affected_chunks: list[str] = []

        if edit["source_table"] == "transcript_segments":
            cur.execute(
                """
                update transcript_segments
                set
                  text = %s,
                  raw_segment = jsonb_set(
                    coalesce(raw_segment, '{}'::jsonb),
                    '{text}',
                    to_jsonb(%s::text),
                    true
                  ),
                  updated_at = now()
                where track_id = %s
                  and segment_id = %s
                  and regexp_replace(text, '\\s+', ' ', 'g') = %s
                """,
                (edited, edited, track_id, segment_id, original),
            )
            segment_updates = cur.rowcount
            cur.execute(
                """
                update transcript_chunks
                set
                  text = replace(text, %s, %s),
                  embedding = null,
                  embedding_model = '',
                  embedding_dimensions = 0,
                  prompt_tokens = 0,
                  metadata = jsonb_set(
                    jsonb_set(coalesce(metadata, '{}'::jsonb), '{manual_edit_request_id}', to_jsonb(%s::bigint), true),
                    '{needs_revectorization}',
                    'true'::jsonb,
                    true
                  ),
                  updated_at = now()
                where track_id = %s
                  and text like ('%%' || %s || '%%')
                returning custom_id
                """,
                (original, edited, edit["id"], track_id, original),
            )
            affected_chunks = [row[0] for row in cur.fetchall()]
        elif edit["source_table"] == "transcript_chunks":
            cur.execute(
                """
                update transcript_chunks
                set
                  text = %s,
                  embedding = null,
                  embedding_model = '',
                  embedding_dimensions = 0,
                  prompt_tokens = 0,
                  metadata = jsonb_set(
                    jsonb_set(coalesce(metadata, '{}'::jsonb), '{manual_edit_request_id}', to_jsonb(%s::bigint), true),
                    '{needs_revectorization}',
                    'true'::jsonb,
                    true
                  ),
                  updated_at = now()
                where track_id = %s
                  and custom_id = %s
                  and regexp_replace(text, '\\s+', ' ', 'g') = %s
                returning custom_id
                """,
                (edited, edit["id"], track_id, segment_id, original),
            )
            affected_chunks = [row[0] for row in cur.fetchall()]

        if segment_updates == 0 and not affected_chunks:
            raise RuntimeError("No matching transcript row was updated. The source text may have changed.")

        claim_revectorization = bool(affected_chunks and claim_revectorization)
        cur.execute(
            """
            update transcript_edit_requests
            set
              status = 'applied',
              applied_at = now(),
              updated_at = now(),
              needs_revectorization = %s,
              processing_error = %s,
              claimed_at = null,
              worker_id = '',
              revectorization_attempt_count = revectorization_attempt_count + %s,
              revectorization_claimed_at = case when %s then now() else null end,
              revectorization_worker_id = case when %s then %s else '' end
            where id = %s
            """,
            (
                bool(affected_chunks),
                "" if affected_chunks else "Applied readable transcript edit, but no matching RAG chunk text was found.",
                1 if claim_revectorization else 0,
                claim_revectorization,
                claim_revectorization,
                worker_id,
                edit["id"],
            ),
        )

    return segment_updates, affected_chunks


def embedding_request(api_key: str, model: str, inputs: list[str]) -> dict:
    payload = json.dumps({"model": model, "input": inputs}, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        "https://api.openai.com/v1/embeddings",
        data=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def vector_literal(values: list[float]) -> str:
    return "[" + ",".join(str(float(value)) for value in values) + "]"


def revectorize_chunks(
    conn: psycopg.Connection,
    edit_id: int,
    custom_ids: list[str],
    model: str,
    worker_id: str,
) -> int:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not custom_ids:
        return 0
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required to re-vectorize edited transcript chunks.")

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            select id
            from transcript_edit_requests
            where id = %s
              and status = 'applied'
              and needs_revectorization
              and revectorization_worker_id = %s
            for update
            """,
            (edit_id, worker_id),
        )
        if not cur.fetchone():
            raise RuntimeError("Re-vectorization claim is no longer owned by this worker.")
        cur.execute(
            """
            select custom_id, text
            from transcript_chunks
            where custom_id = any(%s)
            order by custom_id
            """,
            (custom_ids,),
        )
        rows = list(cur.fetchall())

    if not rows:
        raise RuntimeError("Edited transcript chunks disappeared before re-vectorization.")

    body = embedding_request(api_key, model, [row["text"] for row in rows])
    data = body.get("data") or []
    if len(data) != len(rows):
        raise RuntimeError(f"Expected {len(rows)} embeddings, received {len(data)}")

    total_tokens = int((body.get("usage") or {}).get("prompt_tokens") or 0)
    per_chunk_tokens = max(0, round(total_tokens / max(1, len(rows))))
    with conn.cursor() as cur:
        for row, embedding_row in zip(rows, data, strict=True):
            embedding = embedding_row.get("embedding")
            if not isinstance(embedding, list) or not embedding:
                raise RuntimeError(f"Missing embedding for {row['custom_id']}")
            cur.execute(
                """
                update transcript_chunks
                set
                  embedding = %s::vector,
                  embedding_model = %s,
                  embedding_dimensions = %s,
                  prompt_tokens = %s,
                  metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{needs_revectorization}', 'false'::jsonb, true),
                  updated_at = now()
                where custom_id = %s
                """,
                (vector_literal(embedding), body.get("model") or model, len(embedding), per_chunk_tokens, row["custom_id"]),
            )
        cur.execute(
            """
            update transcript_edit_requests
            set needs_revectorization = false,
                processing_error = '',
                next_revectorization_at = now(),
                revectorization_claimed_at = null,
                revectorization_worker_id = '',
                updated_at = now()
            where id = %s
            """,
            (edit_id,),
        )
    return len(rows)


def mark_failed(
    conn: psycopg.Connection,
    edit_id: int,
    attempt_count: int,
    max_attempts: int,
    base_seconds: int,
    worker_id: str,
    error: Exception,
) -> None:
    terminal = attempt_count >= max_attempts
    detail = str(error)[:3900]
    if terminal:
        detail = f"Terminal failure after {attempt_count} attempts: {detail}"[:4000]
    with conn.cursor() as cur:
        cur.execute(
            """
            update transcript_edit_requests
            set status = 'failed', processing_error = %s,
                next_attempt_at = case when %s then 'infinity'::timestamptz
                                       else now() + make_interval(secs => %s) end,
                claimed_at = null, worker_id = '', updated_at = now()
            where id = %s and status = 'applying' and worker_id = %s
            """,
            (detail, terminal, retry_delay_seconds(attempt_count, base_seconds), edit_id, worker_id),
        )


def claim_pending_revectorization(
    conn: psycopg.Connection,
    worker_id: str,
    max_attempts: int,
) -> dict | None:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            with claimed as (
              select id
              from transcript_edit_requests
              where status = 'applied'
                and needs_revectorization
                and revectorization_attempt_count < %s
                and next_revectorization_at <= now()
                and revectorization_claimed_at is null
              order by updated_at asc, id asc
              limit 1
              for update skip locked
            )
            update transcript_edit_requests r
            set revectorization_attempt_count = r.revectorization_attempt_count + 1,
                revectorization_claimed_at = now(),
                revectorization_worker_id = %s,
                processing_error = '',
                updated_at = now()
            from claimed
            where r.id = claimed.id
            returning r.id, r.revectorization_attempt_count
            """,
            (max_attempts, worker_id),
        )
        rows = list(cur.fetchall())
        return rows[0] if rows else None


def chunk_ids_for_edit(conn: psycopg.Connection, edit_id: int) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select custom_id
            from transcript_chunks
            where metadata ->> 'manual_edit_request_id' = %s
              and metadata ->> 'needs_revectorization' = 'true'
            order by custom_id
            """,
            (str(edit_id),),
        )
        return [row[0] for row in cur.fetchall()]


def mark_revectorization_failed(
    conn: psycopg.Connection,
    edit_id: int,
    attempt_count: int,
    max_attempts: int,
    base_seconds: int,
    worker_id: str,
    error: Exception,
) -> None:
    terminal = attempt_count >= max_attempts
    detail = str(error)[:3900]
    if terminal:
        detail = f"Terminal re-vectorization failure after {attempt_count} attempts: {detail}"[:4000]
    with conn.cursor() as cur:
        cur.execute(
            """
            update transcript_edit_requests
            set processing_error = %s,
                next_revectorization_at = case when %s then 'infinity'::timestamptz
                                               else now() + make_interval(secs => %s) end,
                revectorization_claimed_at = null,
                revectorization_worker_id = '',
                updated_at = now()
            where id = %s and status = 'applied' and needs_revectorization
              and revectorization_worker_id = %s
            """,
            (detail, terminal, retry_delay_seconds(attempt_count, base_seconds), edit_id, worker_id),
        )


def process_pending_revectorizations(
    conn: psycopg.Connection,
    model: str,
    worker_id: str,
    limit: int,
    max_attempts: int,
    base_seconds: int,
) -> tuple[int, int]:
    completed = 0
    failed = 0
    while completed + failed < limit:
        pending = claim_pending_revectorization(conn, worker_id, max_attempts)
        conn.commit()
        if not pending:
            break
        edit_id = int(pending["id"])
        try:
            custom_ids = chunk_ids_for_edit(conn, edit_id)
            if not custom_ids:
                raise RuntimeError("No edited chunks remain available for re-vectorization.")
            revectorize_chunks(conn, edit_id, custom_ids, model, worker_id)
            conn.commit()
            completed += 1
        except Exception as error:
            conn.rollback()
            mark_revectorization_failed(
                conn,
                edit_id,
                int(pending["revectorization_attempt_count"]),
                max_attempts,
                base_seconds,
                worker_id,
                error,
            )
            conn.commit()
            failed += 1
    return completed, failed


def terminal_backlog_counts(conn: psycopg.Connection) -> tuple[int, int]:
    with conn.cursor() as cur:
        cur.execute(
            """
            select
              count(*) filter (
                where status = 'failed' and next_attempt_at = 'infinity'::timestamptz
              )::int,
              count(*) filter (
                where status = 'applied'
                  and needs_revectorization
                  and next_revectorization_at = 'infinity'::timestamptz
              )::int
            from transcript_edit_requests
            """
        )
        row = cur.fetchone()
        return (int(row[0] or 0), int(row[1] or 0))


def main() -> int:
    args = parse_args()
    if args.limit < 1:
        raise SystemExit("--limit must be >= 1")
    if args.max_attempts < 1 or args.retry_base_seconds < 1 or args.claim_lease_seconds < 1:
        raise SystemExit("retry and lease settings must be >= 1")
    if args.force_retry_terminal and (
        not args.edit_id or not args.retry_actor.strip() or not args.retry_reason.strip()
    ):
        raise SystemExit(
            "--force-retry-terminal requires --edit-id, --retry-actor, and --retry-reason for an auditable reset"
        )
    load_env(args.env_file)
    embedding_model = resolve_embedding_model(args.embedding_model)
    worker_id = f"{socket.gethostname()}:{os.getpid()}"

    counts = {
        "recovered": 0,
        "revectorization_recovered": 0,
        "terminal_resets": 0,
        "claimed": 0,
        "applied": 0,
        "failed": 0,
        "segment_updates": 0,
        "chunk_updates": 0,
        "chunks_revectorized": 0,
        "backlog_revectorized": 0,
        "backlog_failed": 0,
        "terminal_edit_backlog": 0,
        "terminal_revectorization_backlog": 0,
    }
    with psycopg.connect(dsn()) as conn:
        if args.force_retry_terminal:
            counts["terminal_resets"] = reset_terminal_requests(
                conn,
                args.edit_id,
                args.retry_actor.strip().lower(),
                args.retry_reason.strip()[:1000],
            )
            conn.commit()
        counts["recovered"] = recover_stale_edits(conn, args.claim_lease_seconds, args.max_attempts)
        counts["revectorization_recovered"] = recover_stale_revectorizations(
            conn,
            args.claim_lease_seconds,
            args.max_attempts,
        )
        conn.commit()
        if not args.skip_revectorize:
            backlog_completed, backlog_failed = process_pending_revectorizations(
                conn,
                embedding_model,
                worker_id,
                args.limit,
                args.max_attempts,
                args.retry_base_seconds,
            )
            counts["backlog_revectorized"] = backlog_completed
            counts["backlog_failed"] = backlog_failed

        while counts["claimed"] < args.limit:
            edit = claim_next_edit(conn, worker_id, args.max_attempts, args.edit_id)
            conn.commit()
            if not edit:
                break
            counts["claimed"] += 1
            try:
                segment_updates, affected_chunks = apply_edit(
                    conn,
                    edit,
                    worker_id,
                    not args.skip_revectorize,
                )
                chunks_revectorized = 0
                if not args.skip_revectorize:
                    chunks_revectorized = revectorize_chunks(
                        conn,
                        int(edit["id"]),
                        affected_chunks,
                        embedding_model,
                        worker_id,
                    )
                counts["applied"] += 1
                counts["segment_updates"] += segment_updates
                counts["chunk_updates"] += len(affected_chunks)
                counts["chunks_revectorized"] += chunks_revectorized
                conn.commit()
            except Exception as error:
                conn.rollback()
                mark_failed(
                    conn,
                    int(edit["id"]),
                    int(edit["attempt_count"]),
                    args.max_attempts,
                    args.retry_base_seconds,
                    worker_id,
                    error,
                )
                counts["failed"] += 1
                conn.commit()

        terminal_edits, terminal_revectorizations = terminal_backlog_counts(conn)
        counts["terminal_edit_backlog"] = terminal_edits
        counts["terminal_revectorization_backlog"] = terminal_revectorizations

    print(counts)
    return 0 if (
        counts["failed"] == 0
        and counts["backlog_failed"] == 0
        and counts["terminal_edit_backlog"] == 0
        and counts["terminal_revectorization_backlog"] == 0
    ) else 1


if __name__ == "__main__":
    raise SystemExit(main())
