#!/usr/bin/env python3
"""Apply queued transcript edits and mark affected RAG chunks for re-vectorizing."""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

import psycopg


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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--edit-id", type=int, action="append", default=[])
    parser.add_argument("--embedding-model", default=os.environ.get("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"))
    parser.add_argument("--skip-revectorize", action="store_true")
    return parser.parse_args()


def claim_edits(conn: psycopg.Connection, limit: int, edit_ids: list[int]) -> list[dict]:
    if edit_ids:
        sql = """
            update transcript_edit_requests
            set status = 'applying', updated_at = now(), processing_error = ''
            where id = any(%s)
              and status in ('pending', 'failed')
            returning
              id, track_id, segment_id, source_table, source_field,
              original_text, edited_text
        """
        params = (edit_ids,)
    else:
        sql = """
            with claimed as (
              select id
              from transcript_edit_requests
              where status in ('pending', 'failed')
              order by created_at asc
              limit %s
              for update skip locked
            )
            update transcript_edit_requests r
            set status = 'applying', updated_at = now(), processing_error = ''
            from claimed
            where r.id = claimed.id
            returning
              r.id, r.track_id, r.segment_id, r.source_table, r.source_field,
              r.original_text, r.edited_text
        """
        params = (limit,)

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def apply_edit(conn: psycopg.Connection, edit: dict) -> tuple[int, list[str]]:
    original = edit["original_text"]
    edited = edit["edited_text"]
    track_id = edit["track_id"]
    segment_id = edit["segment_id"]

    with conn.cursor() as cur:
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

        cur.execute(
            """
            update transcript_edit_requests
            set
              status = 'applied',
              applied_at = now(),
              updated_at = now(),
              needs_revectorization = %s,
              processing_error = %s
            where id = %s
            """,
            (
                bool(affected_chunks),
                "" if affected_chunks else "Applied readable transcript edit, but no matching RAG chunk text was found.",
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
) -> int:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key or not custom_ids:
        return 0

    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
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
        return 0

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
            set needs_revectorization = false, updated_at = now()
            where id = %s
            """,
            (edit_id,),
        )
    return len(rows)


def mark_failed(conn: psycopg.Connection, edit_id: int, error: Exception) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            update transcript_edit_requests
            set status = 'failed', processing_error = %s, updated_at = now()
            where id = %s
            """,
            (str(error)[:4000], edit_id),
        )


def main() -> int:
    args = parse_args()
    if args.limit < 1:
        raise SystemExit("--limit must be >= 1")
    load_env(args.env_file)

    counts = {
        "claimed": 0,
        "applied": 0,
        "failed": 0,
        "segment_updates": 0,
        "chunk_updates": 0,
        "chunks_revectorized": 0,
    }
    with psycopg.connect(dsn()) as conn:
        edits = claim_edits(conn, args.limit, args.edit_id)
        counts["claimed"] = len(edits)
        for edit in edits:
            try:
                segment_updates, affected_chunks = apply_edit(conn, edit)
                chunks_revectorized = 0
                if not args.skip_revectorize:
                    chunks_revectorized = revectorize_chunks(conn, int(edit["id"]), affected_chunks, args.embedding_model)
                counts["applied"] += 1
                counts["segment_updates"] += segment_updates
                counts["chunk_updates"] += len(affected_chunks)
                counts["chunks_revectorized"] += chunks_revectorized
                conn.commit()
            except Exception as error:
                conn.rollback()
                mark_failed(conn, int(edit["id"]), error)
                counts["failed"] += 1
                conn.commit()

    print(counts)
    return 0 if counts["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
