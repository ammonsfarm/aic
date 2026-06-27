#!/usr/bin/env python3
"""Embed Pastor Wood post chunks into the Postgres pgvector serving tables."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path

import psycopg
from psycopg.rows import dict_row


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
    parser.add_argument("--source-type", choices=["pastorwood_devotional", "pastorwood_resource"], default="pastorwood_devotional")
    parser.add_argument("--embedding-model", default=os.environ.get("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def vector_literal(values: list[float]) -> str:
    return "[" + ",".join(str(float(value)) for value in values) + "]"


def embedding_input(row: dict) -> str:
    pieces = [
        str(row.get("title") or "").strip(),
        str(row.get("publish_date") or "").strip(),
        str(row.get("source_url") or "").strip(),
        "",
        str(row.get("text") or "").strip(),
    ]
    return "\n".join(piece for piece in pieces if piece != "").strip()


def input_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def embedding_request(api_key: str, model: str, inputs: list[str]) -> dict:
    payload = json.dumps({"model": model, "input": inputs, "encoding_format": "float"}, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        "https://api.openai.com/v1/embeddings",
        data=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.loads(response.read().decode("utf-8"))


def select_pending_chunks(conn: psycopg.Connection, source_type: str, model: str, limit: int, force: bool) -> list[dict]:
    sql = """
        select custom_id, post_id, source_type, title, publish_date, source_url, chunk_index, text, content_hash
        from pastorwood_post_chunks
        where source_type = %s
    """
    params: list[object] = [source_type]
    if not force:
        sql += " and (embedding is null or embedding_dimensions = 0 or embedding_model <> %s)"
        params.append(model)
    sql += " order by nullif(publish_date, '')::date asc nulls last, post_id asc, chunk_index asc"
    if limit > 0:
        sql += " limit %s"
        params.append(limit)

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def update_embeddings(conn: psycopg.Connection, rows: list[dict], body: dict, model: str) -> int:
    data = body.get("data") or []
    if len(data) != len(rows):
        raise RuntimeError(f"Expected {len(rows)} embeddings, received {len(data)}")

    total_tokens = int((body.get("usage") or {}).get("prompt_tokens") or 0)
    per_chunk_tokens = max(0, round(total_tokens / max(1, len(rows))))
    updated = 0
    with conn.cursor() as cur:
        for row, embedding_row in zip(rows, data, strict=True):
            embedding = embedding_row.get("embedding")
            if not isinstance(embedding, list) or not embedding:
                raise RuntimeError(f"Missing embedding for {row['custom_id']}")
            source_input = embedding_input(row)
            cur.execute(
                """
                update pastorwood_post_chunks
                set
                  embedding = %s::vector,
                  embedding_model = %s,
                  embedding_dimensions = %s,
                  prompt_tokens = %s,
                  metadata = jsonb_set(
                    jsonb_set(coalesce(metadata, '{}'::jsonb), '{embedded_input_hash}', to_jsonb(%s::text), true),
                    '{embedded_at}',
                    to_jsonb(now()::text),
                    true
                  ),
                  updated_at = now()
                where custom_id = %s
                """,
                (
                    vector_literal(embedding),
                    body.get("model") or model,
                    len(embedding),
                    per_chunk_tokens,
                    input_hash(source_input),
                    row["custom_id"],
                ),
            )
            updated += cur.rowcount
    return updated


def main() -> int:
    args = parse_args()
    if args.batch_size < 1 or args.batch_size > 128:
        raise SystemExit("--batch-size must be between 1 and 128")

    load_env(args.env_file)
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key and not args.dry_run:
        raise SystemExit("OPENAI_API_KEY is required to vectorize Pastor Wood post chunks")

    counts = {
        "source_type": args.source_type,
        "embedding_model": args.embedding_model,
        "selected": 0,
        "embedded": 0,
        "batches": 0,
        "dry_run": args.dry_run,
    }

    with psycopg.connect(dsn()) as conn:
        rows = select_pending_chunks(conn, args.source_type, args.embedding_model, args.limit, args.force)
        counts["selected"] = len(rows)
        if args.dry_run or not rows:
            print(json.dumps(counts, indent=2, sort_keys=True))
            return 0

        for start in range(0, len(rows), args.batch_size):
            batch = rows[start : start + args.batch_size]
            body = embedding_request(api_key, args.embedding_model, [embedding_input(row) for row in batch])
            counts["embedded"] += update_embeddings(conn, batch, body, args.embedding_model)
            counts["batches"] += 1
            conn.commit()

    print(json.dumps(counts, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        raise SystemExit(130)
