#!/usr/bin/env python3
"""Sync the local SQLite RAG/intelligence database into Postgres/pgvector."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Iterable

import psycopg

from scripts.aic_database_env import CANONICAL_AIC_ENV, database_dsn, load_canonical_aic_env


DEFAULT_SQLITE_DB = Path("rag_test.sqlite3")


def load_env(path: Path) -> None:
    load_canonical_aic_env(path)


def dsn() -> str:
    return database_dsn(application_name="aic-sqlite-serving-sync")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync SQLite staging data into the AIC Postgres serving DB.")
    parser.add_argument("--sqlite-db", type=Path, default=DEFAULT_SQLITE_DB)
    parser.add_argument("--env-file", type=Path, default=CANONICAL_AIC_ENV)
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--skip-vectors", action="store_true")
    return parser.parse_args()


def rows(conn: sqlite3.Connection, query: str) -> Iterable[sqlite3.Row]:
    conn.row_factory = sqlite3.Row
    yield from conn.execute(query)


def vector_literal(value: str) -> str | None:
    if not value:
        return None
    parsed = json.loads(value)
    if not isinstance(parsed, list):
        return None
    return "[" + ",".join(str(float(item)) for item in parsed) + "]"


def json_text(value: str, default: str = "[]") -> str:
    if value is None or value == "":
        return default
    json.loads(value)
    return value


def chunks(items: list[tuple], size: int) -> Iterable[list[tuple]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def sync_episodes(sqlite_conn: sqlite3.Connection, pg: psycopg.Connection, batch_size: int) -> int:
    data: dict[str, dict] = {}
    for row in rows(
        sqlite_conn,
        """
        select track_id, title, album, publish_date, category, detail, source_file
        from rag_chunks
        group by track_id
        """,
    ):
        data[str(row["track_id"])] = dict(row)
    for row in rows(
        sqlite_conn,
        """
        select track_id, title, publish_date, source_file
        from episode_intelligence
        """,
    ):
        item = data.setdefault(str(row["track_id"]), {})
        item.setdefault("track_id", row["track_id"])
        item.setdefault("title", row["title"])
        item.setdefault("publish_date", row["publish_date"])
        item.setdefault("album", "")
        item.setdefault("category", "")
        item.setdefault("detail", "")
        item.setdefault("source_file", row["source_file"])
    payload = [
        (
            item.get("track_id", ""),
            item.get("title", ""),
            item.get("publish_date", ""),
            item.get("album", ""),
            item.get("category", ""),
            item.get("detail", ""),
            item.get("source_file", ""),
        )
        for item in data.values()
        if item.get("track_id")
    ]
    sql = """
        insert into episodes(track_id, title, publish_date, album, category, detail, source_file, updated_at)
        values (%s, %s, %s, %s, %s, %s, %s, now())
        on conflict(track_id) do update set
            title=excluded.title,
            publish_date=excluded.publish_date,
            album=excluded.album,
            category=excluded.category,
            detail=excluded.detail,
            source_file=excluded.source_file,
            updated_at=now()
    """
    with pg.cursor() as cur:
        for batch in chunks(payload, batch_size):
            cur.executemany(sql, batch)
    return len(payload)


def sync_transcript_chunks(sqlite_conn: sqlite3.Connection, pg: psycopg.Connection, batch_size: int, include_vectors: bool) -> int:
    payload = []
    for row in rows(sqlite_conn, "select * from rag_chunks order by track_id, custom_id"):
        payload.append(
            (
                row["custom_id"],
                row["track_id"],
                row["title"],
                row["publish_date"],
                row["category"],
                row["detail"],
                row["start_time"],
                row["end_time"],
                json_text(row["speakers_json"]),
                row["segment_type"],
                row["source_file"],
                row["text"],
                vector_literal(row["embedding_json"]) if include_vectors else None,
                row["embedding_model"] if include_vectors else "",
                row["embedding_dimensions"] if include_vectors else 0,
                row["prompt_tokens"] if include_vectors else 0,
                json_text(row["metadata_json"], "{}"),
                row["created_at"],
            )
        )
    sql = """
        insert into transcript_chunks(
            custom_id, track_id, title, publish_date, category, detail, start_time, end_time,
            speakers, segment_type, source_file, text, embedding, embedding_model,
            embedding_dimensions, prompt_tokens, metadata, sqlite_created_at, updated_at
        ) values (
            %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s::vector, %s, %s, %s, %s::jsonb, %s, now()
        )
        on conflict(custom_id) do update set
            title=excluded.title,
            publish_date=excluded.publish_date,
            category=excluded.category,
            detail=excluded.detail,
            start_time=excluded.start_time,
            end_time=excluded.end_time,
            speakers=excluded.speakers,
            segment_type=excluded.segment_type,
            source_file=excluded.source_file,
            text=excluded.text,
            embedding=coalesce(excluded.embedding, transcript_chunks.embedding),
            embedding_model=excluded.embedding_model,
            embedding_dimensions=excluded.embedding_dimensions,
            prompt_tokens=excluded.prompt_tokens,
            metadata=excluded.metadata,
            sqlite_created_at=excluded.sqlite_created_at,
            updated_at=now()
    """
    with pg.cursor() as cur:
        for batch in chunks(payload, batch_size):
            cur.executemany(sql, batch)
    return len(payload)


def sync_episode_intelligence(sqlite_conn: sqlite3.Connection, pg: psycopg.Connection, batch_size: int) -> int:
    payload = [
        (
            row["track_id"],
            row["title"],
            row["publish_date"],
            row["episode_type"],
            row["executive_summary"],
            row["long_summary"],
            json_text(row["main_topics_json"]),
            json_text(row["search_keywords_json"]),
            json_text(row["raw_json"], "{}"),
            row["source_file"],
            row["model"],
            row["input_chars"],
            bool(row["transcript_truncated"]),
            row["status"],
            row["error"],
            row["created_at"],
            row["updated_at"],
        )
        for row in rows(sqlite_conn, "select * from episode_intelligence order by track_id")
    ]
    sql = """
        insert into episode_intelligence(
            track_id, title, publish_date, episode_type, executive_summary, long_summary,
            main_topics, search_keywords, raw_json, source_file, source_model,
            input_chars, transcript_truncated, status, error, sqlite_created_at,
            source_updated_at, updated_at
        ) values (
            %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, now()
        )
        on conflict(track_id) do update set
            title=excluded.title,
            publish_date=excluded.publish_date,
            episode_type=excluded.episode_type,
            executive_summary=excluded.executive_summary,
            long_summary=excluded.long_summary,
            main_topics=excluded.main_topics,
            search_keywords=excluded.search_keywords,
            raw_json=excluded.raw_json,
            source_file=excluded.source_file,
            source_model=excluded.source_model,
            input_chars=excluded.input_chars,
            transcript_truncated=excluded.transcript_truncated,
            status=excluded.status,
            error=excluded.error,
            sqlite_created_at=excluded.sqlite_created_at,
            source_updated_at=excluded.source_updated_at,
            updated_at=now()
    """
    with pg.cursor() as cur:
        for batch in chunks(payload, batch_size):
            cur.executemany(sql, batch)
    return len(payload)


def sync_episode_intelligence_items(sqlite_conn: sqlite3.Connection, pg: psycopg.Connection, batch_size: int) -> int:
    payload = [
        (
            row["id"],
            row["track_id"],
            row["item_type"],
            row["label"],
            row["summary"],
            json_text(row["source_times_json"]),
            json_text(row["speakers_json"]),
            row["confidence"],
            json_text(row["value_json"], "{}"),
            row["created_at"],
        )
        for row in rows(sqlite_conn, "select * from episode_intelligence_items order by id")
    ]
    sql = """
        insert into episode_intelligence_items(
            id, track_id, item_type, label, summary, source_times, speakers,
            confidence, value_json, sqlite_created_at, updated_at
        ) values (
            %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s::jsonb, %s, now()
        )
        on conflict(id) do update set
            track_id=excluded.track_id,
            item_type=excluded.item_type,
            label=excluded.label,
            summary=excluded.summary,
            source_times=excluded.source_times,
            speakers=excluded.speakers,
            confidence=excluded.confidence,
            value_json=excluded.value_json,
            sqlite_created_at=excluded.sqlite_created_at,
            updated_at=now()
    """
    with pg.cursor() as cur:
        for batch in chunks(payload, batch_size):
            cur.executemany(sql, batch)
    return len(payload)


def sync_episode_intelligence_vectors(sqlite_conn: sqlite3.Connection, pg: psycopg.Connection, batch_size: int, include_vectors: bool) -> int:
    try:
        source_rows = list(rows(sqlite_conn, "select * from episode_intelligence_vectors order by custom_id"))
    except sqlite3.OperationalError:
        return 0
    payload = []
    for row in source_rows:
        payload.append(
            (
                row["custom_id"],
                row["vector_type"],
                row["track_id"],
                row["title"],
                row["publish_date"],
                row["episode_type"],
                row["label"],
                row["text"],
                row["source_table"],
                row["source_id"],
                row["source_field"],
                row["source_model"],
                row["source_updated_at"],
                row["content_hash"],
                json_text(row["source_times_json"]),
                json_text(row["speakers_json"]),
                row["confidence"],
                json_text(row["metadata_json"], "{}"),
                vector_literal(row["embedding_json"]) if include_vectors else None,
                row["embedding_model"] if include_vectors else "",
                row["embedding_dimensions"] if include_vectors else 0,
                row["prompt_tokens"] if include_vectors else 0,
                row["created_at"],
            )
        )
    sql = """
        insert into episode_intelligence_vectors(
            custom_id, vector_type, track_id, title, publish_date, episode_type,
            label, text, source_table, source_id, source_field, source_model,
            source_updated_at, content_hash, source_times, speakers, confidence,
            metadata, embedding, embedding_model, embedding_dimensions, prompt_tokens,
            sqlite_created_at, updated_at
        ) values (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb,
            %s, %s::jsonb, %s::vector, %s, %s, %s, %s, now()
        )
        on conflict(custom_id) do update set
            vector_type=excluded.vector_type,
            track_id=excluded.track_id,
            title=excluded.title,
            publish_date=excluded.publish_date,
            episode_type=excluded.episode_type,
            label=excluded.label,
            text=excluded.text,
            source_table=excluded.source_table,
            source_id=excluded.source_id,
            source_field=excluded.source_field,
            source_model=excluded.source_model,
            source_updated_at=excluded.source_updated_at,
            content_hash=excluded.content_hash,
            source_times=excluded.source_times,
            speakers=excluded.speakers,
            confidence=excluded.confidence,
            metadata=excluded.metadata,
            embedding=coalesce(excluded.embedding, episode_intelligence_vectors.embedding),
            embedding_model=excluded.embedding_model,
            embedding_dimensions=excluded.embedding_dimensions,
            prompt_tokens=excluded.prompt_tokens,
            sqlite_created_at=excluded.sqlite_created_at,
            updated_at=now()
    """
    with pg.cursor() as cur:
        for batch in chunks(payload, batch_size):
            cur.executemany(sql, batch)
    return len(payload)


def main() -> int:
    args = parse_args()
    load_env(args.env_file)
    sqlite_conn = sqlite3.connect(args.sqlite_db)
    sqlite_conn.row_factory = sqlite3.Row
    counts: dict[str, int] = {}
    try:
        with psycopg.connect(dsn()) as pg:
            run_id = pg.execute(
                "insert into sync_runs(source_sqlite_path) values (%s) returning id",
                (str(args.sqlite_db),),
            ).fetchone()[0]
            try:
                counts["episodes"] = sync_episodes(sqlite_conn, pg, args.batch_size)
                counts["transcript_chunks"] = sync_transcript_chunks(sqlite_conn, pg, args.batch_size, not args.skip_vectors)
                counts["episode_intelligence"] = sync_episode_intelligence(sqlite_conn, pg, args.batch_size)
                counts["episode_intelligence_items"] = sync_episode_intelligence_items(sqlite_conn, pg, args.batch_size)
                counts["episode_intelligence_vectors"] = sync_episode_intelligence_vectors(
                    sqlite_conn, pg, args.batch_size, not args.skip_vectors
                )
                pg.execute(
                    """
                    update sync_runs set completed_at=now(), status='completed',
                        episodes_count=%s,
                        transcript_chunks_count=%s,
                        episode_intelligence_count=%s,
                        episode_intelligence_items_count=%s,
                        episode_intelligence_vectors_count=%s
                    where id=%s
                    """,
                    (
                        counts["episodes"],
                        counts["transcript_chunks"],
                        counts["episode_intelligence"],
                        counts["episode_intelligence_items"],
                        counts["episode_intelligence_vectors"],
                        run_id,
                    ),
                )
                pg.commit()
            except Exception as error:
                pg.execute(
                    "update sync_runs set completed_at=now(), status='failed', error=%s where id=%s",
                    (str(error), run_id),
                )
                pg.commit()
                raise
    finally:
        sqlite_conn.close()
    print(json.dumps(counts, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
