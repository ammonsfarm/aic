#!/usr/bin/env python3
"""Import Pastor Wood WordPress DB posts into the AIC writings/RAG tables."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

from sync_pastorwood_posts import chunk_text, content_hash, dsn, load_env, strip_rendered_html, wp_timestamp


DEFAULT_SOURCE_BASE_URL = "https://www.pastorwood.org"
SOURCE_TYPE_BY_CATEGORY = {
    "weekly-devotional": "pastorwood_devotional",
    "resources": "pastorwood_resource",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--source-base-url", default=DEFAULT_SOURCE_BASE_URL)
    parser.add_argument("--source-mode", choices=["docker", "direct"], default="docker")
    parser.add_argument("--docker-container", default=os.environ.get("PWOOD_DB_CONTAINER", "farm-postgres"))
    parser.add_argument("--pwood-db-name", default=os.environ.get("PWOOD_DB_NAME", "pwood"))
    parser.add_argument("--pwood-db-user", default=os.environ.get("PWOOD_DB_USER", "farmfam"))
    parser.add_argument("--pwood-db-host", default=os.environ.get("PWOOD_DB_HOST", "127.0.0.1"))
    parser.add_argument("--pwood-db-port", default=os.environ.get("PWOOD_DB_PORT", "5433"))
    parser.add_argument("--pwood-db-password", default=os.environ.get("PWOOD_DB_PASSWORD", ""))
    parser.add_argument("--status", action="append", default=["publish"])
    parser.add_argument("--category-slug", action="append", choices=sorted(SOURCE_TYPE_BY_CATEGORY), default=[])
    parser.add_argument("--chunk-chars", type=int, default=2400)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args()


def source_sql(category_slugs: list[str], statuses: list[str]) -> str:
    categories_json = json.dumps(category_slugs)
    statuses_json = json.dumps(statuses)
    return f"""
      with requested_categories(slug) as (
        select jsonb_array_elements_text('{categories_json}'::jsonb)
      ),
      requested_statuses(status) as (
        select jsonb_array_elements_text('{statuses_json}'::jsonb)
      ),
      source_rows as (
        select distinct on (p."ID", t."slug")
          p."ID"::bigint as post_id,
          case
            when t."slug" = 'weekly-devotional' then 'pastorwood_devotional'
            when t."slug" = 'resources' then 'pastorwood_resource'
            else t."slug"
          end as source_type,
          t."term_id"::integer as wp_category_id,
          t."slug" as category_slug,
          p."post_date"::text as post_date,
          p."post_date_gmt"::text as post_date_gmt,
          p."post_modified"::text as post_modified,
          p."post_modified_gmt"::text as post_modified_gmt,
          p."post_title" as post_title,
          p."post_name" as post_name,
          p."post_status" as post_status,
          p."post_content" as post_content
        from wp_posts p
        join wp_term_relationships tr
          on tr."object_id" = p."ID"
        join wp_term_taxonomy tt
          on tt."term_taxonomy_id" = tr."term_taxonomy_id"
        join wp_terms t
          on t."term_id" = tt."term_id"
        join requested_categories rc
          on rc.slug = t."slug"
        join requested_statuses rs
          on rs.status = p."post_status"
        where tt."taxonomy" = 'category'
          and p."post_type" = 'post'
        order by p."ID", t."slug", p."post_date"::timestamp desc
      )
      select coalesce(jsonb_agg(to_jsonb(source_rows) order by post_date::timestamp asc, post_id asc), '[]'::jsonb)
      from source_rows;
    """


def fetch_source_rows_via_docker(args: argparse.Namespace, category_slugs: list[str], statuses: list[str]) -> list[dict[str, Any]]:
    command = [
      "docker",
      "exec",
      "-i",
      args.docker_container,
      "psql",
      "-U",
      args.pwood_db_user,
      "-d",
      args.pwood_db_name,
      "-At",
      "-c",
      source_sql(category_slugs, statuses),
    ]
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode != 0:
      raise RuntimeError(result.stderr.strip() or f"docker psql exited {result.returncode}")
    return json.loads(result.stdout.strip() or "[]")


def fetch_source_rows_direct(args: argparse.Namespace, category_slugs: list[str], statuses: list[str]) -> list[dict[str, Any]]:
    source_dsn = (
      f"host={args.pwood_db_host} "
      f"port={args.pwood_db_port} "
      f"dbname={args.pwood_db_name} "
      f"user={args.pwood_db_user} "
      f"password={args.pwood_db_password}"
    )
    with psycopg.connect(source_dsn) as conn:
      with conn.cursor() as cur:
        cur.execute(source_sql(category_slugs, statuses))
        return json.loads(cur.fetchone()[0] or "[]")


def fetch_source_rows(args: argparse.Namespace) -> list[dict[str, Any]]:
    category_slugs = args.category_slug or list(SOURCE_TYPE_BY_CATEGORY)
    statuses = [status.strip() for status in args.status if status.strip()]
    if args.source_mode == "direct":
      return fetch_source_rows_direct(args, category_slugs, statuses)
    return fetch_source_rows_via_docker(args, category_slugs, statuses)


def url_for_post(source_base_url: str, post_date: str, slug: str) -> str:
    parsed = datetime.fromisoformat(post_date.replace(" ", "T"))
    return f"{source_base_url.rstrip('/')}/{parsed:%Y/%m}/{slug.strip('/')}/"


def date_for_post(post_date: str) -> str | None:
    if not post_date:
      return None
    return datetime.fromisoformat(post_date.replace(" ", "T")).date().isoformat()


def begin_run(conn: psycopg.Connection, args: argparse.Namespace, row_count: int, counts_by_type: Counter[str]) -> int:
    with conn.cursor() as cur:
      cur.execute(
        """
        insert into pastorwood_scrape_runs(source_base_url, source_type, category_id, after_date, metadata)
        values (%s, %s, null, null, %s::jsonb)
        returning id
        """,
        (
          "postgres:pwood.wp_posts",
          "pastorwood_wp_db",
          json.dumps(
            {
              "dry_run": args.dry_run,
              "source_mode": args.source_mode,
              "rows_selected": row_count,
              "source_counts": dict(counts_by_type),
            },
            separators=(",", ":"),
          ),
        ),
      )
      return int(cur.fetchone()[0])


def finish_run(conn: psycopg.Connection, run_id: int, counts: dict[str, Any], status: str, error: str = "") -> None:
    with conn.cursor() as cur:
      cur.execute(
        """
        update pastorwood_scrape_runs
        set
          completed_at = now(),
          pages_seen = %s,
          posts_seen = %s,
          posts_upserted = %s,
          chunks_upserted = %s,
          status = %s,
          error = %s,
          metadata = metadata || %s::jsonb
        where id = %s
        """,
        (
          1,
          counts["posts_seen"],
          counts["posts_changed"],
          counts["chunks_upserted"],
          status,
          error[:4000],
          json.dumps(counts.get("metadata", {}), separators=(",", ":")),
          run_id,
        ),
      )


def upsert_chunks(
    conn: psycopg.Connection,
    post_id: int,
    source_type: str,
    title: str,
    publish_date: str,
    source_url: str,
    chunks: list[str],
) -> None:
    with conn.cursor() as cur:
      for index, chunk in enumerate(chunks):
        chunk_id = f"{source_type}:{post_id}:{index:04d}"
        chunk_hash = content_hash(source_type, str(post_id), str(index), chunk)
        cur.execute(
          """
          insert into pastorwood_post_chunks(
            custom_id,
            post_id,
            source_type,
            title,
            publish_date,
            source_url,
            chunk_index,
            text,
            content_hash,
            metadata
          )
          values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
          on conflict (custom_id) do update
          set
            title = excluded.title,
            publish_date = excluded.publish_date,
            source_url = excluded.source_url,
            text = excluded.text,
            content_hash = excluded.content_hash,
            embedding = case
              when pastorwood_post_chunks.content_hash is distinct from excluded.content_hash then null
              else pastorwood_post_chunks.embedding
            end,
            embedding_model = case
              when pastorwood_post_chunks.content_hash is distinct from excluded.content_hash then ''
              else pastorwood_post_chunks.embedding_model
            end,
            embedding_dimensions = case
              when pastorwood_post_chunks.content_hash is distinct from excluded.content_hash then 0
              else pastorwood_post_chunks.embedding_dimensions
            end,
            prompt_tokens = case
              when pastorwood_post_chunks.content_hash is distinct from excluded.content_hash then 0
              else pastorwood_post_chunks.prompt_tokens
            end,
            metadata = excluded.metadata,
            updated_at = case
              when pastorwood_post_chunks.content_hash is distinct from excluded.content_hash then now()
              else pastorwood_post_chunks.updated_at
            end
          """,
          (
            chunk_id,
            post_id,
            source_type,
            title,
            publish_date,
            source_url,
            index,
            chunk,
            chunk_hash,
            json.dumps({"source": "wordpress_db", "chunk_chars": len(chunk)}, separators=(",", ":")),
          ),
        )

      cur.execute(
        """
        delete from pastorwood_post_chunks
        where post_id = %s
          and source_type = %s
          and chunk_index >= %s
        """,
        (post_id, source_type, len(chunks)),
      )


def upsert_post(conn: psycopg.Connection, row: dict[str, Any], run_id: int, args: argparse.Namespace) -> tuple[bool, int]:
    post_id = int(row["post_id"])
    source_type = str(row["source_type"])
    title = strip_rendered_html(str(row.get("post_title") or ""))
    slug = str(row.get("post_name") or "").strip()
    post_content = str(row.get("post_content") or "")
    post_text = strip_rendered_html(post_content)
    publish_date = date_for_post(str(row.get("post_date") or ""))
    source_url = url_for_post(args.source_base_url, str(row.get("post_date") or ""), slug)
    post_hash = content_hash(source_type, title, post_text)

    with conn.cursor(row_factory=dict_row) as cur:
      cur.execute("select content_hash from pastorwood_posts where post_id = %s", (post_id,))
      existing = cur.fetchone()
      changed = existing is None or existing["content_hash"] != post_hash

      cur.execute(
        """
        insert into pastorwood_posts(
          post_id,
          source_type,
          wp_category_id,
          title,
          slug,
          source_url,
          publish_date,
          published_at,
          modified_at,
          excerpt_html,
          content_html,
          text,
          content_hash,
          raw_json,
          last_scrape_run_id
        )
        values (%s, %s, %s, %s, %s, %s, %s::date, %s::timestamptz, %s::timestamptz, %s, %s, %s, %s, %s::jsonb, %s)
        on conflict (post_id) do update
        set
          source_type = excluded.source_type,
          wp_category_id = excluded.wp_category_id,
          title = excluded.title,
          slug = excluded.slug,
          source_url = excluded.source_url,
          publish_date = excluded.publish_date,
          published_at = excluded.published_at,
          modified_at = excluded.modified_at,
          content_html = excluded.content_html,
          text = excluded.text,
          content_hash = excluded.content_hash,
          summary = case
            when pastorwood_posts.content_hash is distinct from excluded.content_hash then ''
            else pastorwood_posts.summary
          end,
          summary_model = case
            when pastorwood_posts.content_hash is distinct from excluded.content_hash then ''
            else pastorwood_posts.summary_model
          end,
          summary_input_hash = case
            when pastorwood_posts.content_hash is distinct from excluded.content_hash then ''
            else pastorwood_posts.summary_input_hash
          end,
          summary_updated_at = case
            when pastorwood_posts.content_hash is distinct from excluded.content_hash then null
            else pastorwood_posts.summary_updated_at
          end,
          raw_json = excluded.raw_json,
          last_scrape_run_id = excluded.last_scrape_run_id,
          updated_at = case
            when pastorwood_posts.content_hash is distinct from excluded.content_hash then now()
            else pastorwood_posts.updated_at
          end
        """,
        (
          post_id,
          source_type,
          int(row["wp_category_id"]) if row.get("wp_category_id") is not None else None,
          title,
          slug,
          source_url,
          publish_date,
          wp_timestamp(str(row.get("post_date_gmt") or row.get("post_date") or "")),
          wp_timestamp(str(row.get("post_modified_gmt") or row.get("post_modified") or "")),
          "",
          post_content,
          post_text,
          post_hash,
          json.dumps(row, separators=(",", ":")),
          run_id,
        ),
      )

    chunks = chunk_text(post_text, args.chunk_chars)
    upsert_chunks(conn, post_id, source_type, title, publish_date or "", source_url, chunks)
    return changed, len(chunks)


def main() -> int:
    args = parse_args()
    if args.chunk_chars < 800:
      raise SystemExit("--chunk-chars must be >= 800")

    load_env(args.env_file)
    rows = fetch_source_rows(args)
    counts_by_type = Counter(str(row.get("source_type") or "") for row in rows)
    counts: dict[str, Any] = {
      "posts_seen": len(rows),
      "posts_changed": 0,
      "chunks_upserted": 0,
      "dry_run": args.dry_run,
      "metadata": {"source_counts": dict(counts_by_type)},
    }

    if args.dry_run:
      print(json.dumps(counts, indent=2, sort_keys=True))
      return 0

    with psycopg.connect(dsn()) as conn:
      run_id = begin_run(conn, args, len(rows), counts_by_type)
      counts["run_id"] = run_id
      try:
        for row in rows:
          changed, chunk_count = upsert_post(conn, row, run_id, args)
          counts["posts_changed"] += int(changed)
          counts["chunks_upserted"] += chunk_count
          if args.verbose:
            print(f"{row.get('post_date', '')[:10]} {row.get('post_id')}: {row.get('post_title')} ({chunk_count} chunks)")
        finish_run(conn, run_id, counts, "completed")
        conn.commit()
      except Exception as error:
        conn.rollback()
        with psycopg.connect(dsn()) as failure_conn:
          finish_run(failure_conn, run_id, counts, "failed", str(error))
          failure_conn.commit()
        raise

    print(json.dumps(counts, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
      raise SystemExit(main())
    except KeyboardInterrupt:
      print("interrupted", file=sys.stderr)
      raise SystemExit(130)
