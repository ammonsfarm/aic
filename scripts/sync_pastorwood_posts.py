#!/usr/bin/env python3
"""Sync Pastor Wood WordPress posts into Postgres devotional/resource tables."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row


DEFAULT_SOURCE_BASE_URL = "https://www.pastorwood.org"
DEFAULT_CATEGORY_ID = 1448
DEFAULT_AFTER_DATE = "2022-12-01"


class HtmlTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript"}:
            self.ignored_depth += 1
            return

        if tag in {"br", "p", "div", "li", "h1", "h2", "h3", "h4", "blockquote"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"} and self.ignored_depth:
            self.ignored_depth -= 1
            return

        if tag in {"p", "div", "li", "h1", "h2", "h3", "h4", "blockquote"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self.ignored_depth:
            return
        self.parts.append(data)

    def text(self) -> str:
        return "".join(self.parts)


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
    parser.add_argument("--source-base-url", default=DEFAULT_SOURCE_BASE_URL)
    parser.add_argument("--source-type", choices=["pastorwood_devotional", "pastorwood_resource"], default="pastorwood_devotional")
    parser.add_argument("--category-id", type=int, default=DEFAULT_CATEGORY_ID)
    parser.add_argument("--after-date", default=DEFAULT_AFTER_DATE)
    parser.add_argument("--per-page", type=int, default=100)
    parser.add_argument("--max-pages", type=int, default=0)
    parser.add_argument("--limit-posts", type=int, default=0)
    parser.add_argument("--chunk-chars", type=int, default=2400)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args()


def wp_timestamp(value: str) -> str | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).isoformat()
    except ValueError:
        return value


def fetch_json(url: str) -> tuple[list[dict[str, Any]], dict[str, str]]:
    request = urllib.request.Request(url, headers={"User-Agent": "aic-pastorwood-sync/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        headers = {key.lower(): value for key, value in response.headers.items()}
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, list):
        raise RuntimeError(f"Expected a list response from {url}")
    return payload, headers


def strip_rendered_html(rendered: str) -> str:
    unescaped = html.unescape(rendered or "")
    unescaped = re.sub(r"\[/?et_[^\]]*\]", "\n", unescaped)
    unescaped = re.sub(r"\[/?wp:[^\]]*\]", "\n", unescaped)
    extractor = HtmlTextExtractor()
    extractor.feed(unescaped)
    text = html.unescape(extractor.text()).replace("\xa0", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    lines = []
    for line in text.splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        lowered = cleaned.lower()
        if "keep an eye on your inbox for next week's devotional" in lowered:
            continue
        if "keep an eye on your inbox for next week’s devotional" in lowered:
            continue
        if set(cleaned) <= {"_", "-"}:
            continue
        lines.append(cleaned)
    return "\n\n".join(lines).strip()


def rendered_text(value: dict[str, Any] | str | None) -> str:
    if isinstance(value, dict):
        rendered = value.get("rendered", "")
    else:
        rendered = value or ""
    return strip_rendered_html(str(rendered))


def content_hash(*parts: str) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part.encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def split_long_paragraph(paragraph: str, max_chars: int) -> list[str]:
    if len(paragraph) <= max_chars:
        return [paragraph]

    sentences = re.split(r"(?<=[.!?])\s+", paragraph)
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if not sentence:
            continue
        candidate = f"{current} {sentence}".strip()
        if len(candidate) <= max_chars:
            current = candidate
            continue
        if current:
            chunks.append(current)
        if len(sentence) <= max_chars:
            current = sentence
        else:
            chunks.extend(sentence[index : index + max_chars].strip() for index in range(0, len(sentence), max_chars))
            current = ""
    if current:
        chunks.append(current)
    return [chunk for chunk in chunks if chunk]


def chunk_text(text: str, max_chars: int) -> list[str]:
    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", text) if paragraph.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for paragraph in paragraphs:
        paragraph_parts = split_long_paragraph(paragraph, max_chars)
        for part in paragraph_parts:
            part_len = len(part)
            if current and current_len + part_len + 2 > max_chars:
                chunks.append("\n\n".join(current).strip())
                current = []
                current_len = 0
            current.append(part)
            current_len += part_len + 2

    if current:
        chunks.append("\n\n".join(current).strip())

    return chunks


def posts_url(source_base_url: str, category_id: int, after_date: str, per_page: int, page: int) -> str:
    query = urllib.parse.urlencode(
        {
            "categories": str(category_id),
            "after": f"{after_date}T00:00:00",
            "per_page": str(per_page),
            "page": str(page),
            "_fields": "id,date,date_gmt,modified,modified_gmt,slug,link,title,excerpt,content,categories,tags,type,status",
        }
    )
    return f"{source_base_url.rstrip('/')}/wp-json/wp/v2/posts?{query}"


def fetch_posts(args: argparse.Namespace) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    posts: list[dict[str, Any]] = []
    page = 1
    total_pages = 1
    headers: dict[str, str] = {}

    while page <= total_pages:
        if args.max_pages and page > args.max_pages:
            break
        url = posts_url(args.source_base_url, args.category_id, args.after_date, args.per_page, page)
        page_posts, headers = fetch_json(url)
        posts.extend(page_posts)
        total_pages = int(headers.get("x-wp-totalpages", str(total_pages)) or total_pages)
        if args.limit_posts and len(posts) >= args.limit_posts:
            posts = posts[: args.limit_posts]
            break
        page += 1

    metadata = {
        "wp_total": int(headers.get("x-wp-total", len(posts)) or len(posts)),
        "wp_total_pages": total_pages,
        "requested_after_date": args.after_date,
    }
    return posts, metadata


def begin_run(conn: psycopg.Connection, args: argparse.Namespace) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into pastorwood_scrape_runs(source_base_url, source_type, category_id, after_date, metadata)
            values (%s, %s, %s, %s::date, %s::jsonb)
            returning id
            """,
            (
                args.source_base_url.rstrip("/"),
                args.source_type,
                args.category_id,
                args.after_date,
                json.dumps({"dry_run": args.dry_run}),
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
                counts["pages_seen"],
                counts["posts_seen"],
                counts["posts_changed"],
                counts["chunks_upserted"],
                status,
                error[:4000],
                json.dumps(counts.get("metadata", {})),
                run_id,
            ),
        )


def upsert_post(conn: psycopg.Connection, post: dict[str, Any], run_id: int, args: argparse.Namespace) -> tuple[bool, int]:
    post_id = int(post["id"])
    title = rendered_text(post.get("title"))
    excerpt_html = str((post.get("excerpt") or {}).get("rendered", ""))
    content_html = str((post.get("content") or {}).get("rendered", ""))
    post_text = rendered_text(post.get("content"))
    post_hash = content_hash(args.source_type, title, post_text)
    publish_date = str(post.get("date", ""))[:10] or None
    source_url = str(post.get("link", "")).strip()
    slug = str(post.get("slug", "")).strip()
    category_ids = post.get("categories") if isinstance(post.get("categories"), list) else []
    wp_category_id = int(category_ids[0]) if category_ids else args.category_id

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
              excerpt_html = excluded.excerpt_html,
              content_html = excluded.content_html,
              text = excluded.text,
              content_hash = excluded.content_hash,
              raw_json = excluded.raw_json,
              last_scrape_run_id = excluded.last_scrape_run_id,
              updated_at = case
                when pastorwood_posts.content_hash is distinct from excluded.content_hash then now()
                else pastorwood_posts.updated_at
              end
            """,
            (
                post_id,
                args.source_type,
                wp_category_id,
                title,
                slug,
                source_url,
                publish_date,
                wp_timestamp(str(post.get("date_gmt") or post.get("date") or "")),
                wp_timestamp(str(post.get("modified_gmt") or post.get("modified") or "")),
                excerpt_html,
                content_html,
                post_text,
                post_hash,
                json.dumps(post, separators=(",", ":")),
                run_id,
            ),
        )

    chunks = chunk_text(post_text, args.chunk_chars)
    upsert_chunks(conn, post_id, args.source_type, title, publish_date or "", source_url, chunks)
    return changed, len(chunks)


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
                    json.dumps({"source": "wordpress_rest", "chunk_chars": len(chunk)}),
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


def main() -> int:
    args = parse_args()
    if args.per_page < 1 or args.per_page > 100:
        raise SystemExit("--per-page must be between 1 and 100")
    if args.chunk_chars < 800:
        raise SystemExit("--chunk-chars must be >= 800")

    load_env(args.env_file)
    posts, fetch_metadata = fetch_posts(args)
    pages_seen = fetch_metadata.get("wp_total_pages", 0)
    counts: dict[str, Any] = {
        "pages_seen": pages_seen,
        "posts_seen": len(posts),
        "posts_changed": 0,
        "chunks_upserted": 0,
        "metadata": fetch_metadata,
    }

    if args.dry_run:
        print(json.dumps(counts, indent=2, sort_keys=True))
        return 0

    with psycopg.connect(dsn()) as conn:
        run_id = begin_run(conn, args)
        counts["run_id"] = run_id
        try:
            for post in sorted(posts, key=lambda item: str(item.get("date", ""))):
                changed, chunk_count = upsert_post(conn, post, run_id, args)
                counts["posts_changed"] += int(changed)
                counts["chunks_upserted"] += chunk_count
                if args.verbose:
                    print(f"{post.get('date', '')[:10]} {post.get('id')}: {rendered_text(post.get('title'))} ({chunk_count} chunks)")
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
