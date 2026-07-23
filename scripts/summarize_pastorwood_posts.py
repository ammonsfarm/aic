#!/usr/bin/env python3
"""Generate persisted summaries for imported Pastor Wood writings."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

try:
    from scripts.aic_database_env import CANONICAL_AIC_ENV, database_dsn, load_canonical_aic_env
except ModuleNotFoundError:  # Direct execution from /mnt/storage/aic/scripts.
    from aic_database_env import CANONICAL_AIC_ENV, database_dsn, load_canonical_aic_env


SOURCE_TYPES = ("pastorwood_devotional", "pastorwood_resource")


def load_env(path: Path) -> None:
    load_canonical_aic_env(path)


def dsn() -> str:
    return database_dsn(application_name="aic-pastorwood-summary")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=CANONICAL_AIC_ENV)
    parser.add_argument("--source-type", choices=[*SOURCE_TYPES, "all"], default="all")
    parser.add_argument("--provider", choices=["auto", "silo", "openai"], default="auto")
    parser.add_argument("--model", default="")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-source-chars", type=int, default=18000)
    parser.add_argument("--sleep-seconds", type=float, default=0.0)
    parser.add_argument("--timeout-seconds", type=int, default=180)
    return parser.parse_args()


def resolve_provider(provider: str) -> str:
    if provider != "auto":
        return provider
    if os.environ.get("SILO_TEMP_KEY"):
        return "silo"
    return "openai"


def strip_codex_prefix(model: str) -> str:
    return model.removeprefix("openai-codex/")


def default_model(provider: str) -> str:
    if provider == "silo":
        return os.environ.get("OPENAI_RAG_MODEL") or "gpt-5.4-mini"
    return (
        os.environ.get("OPENAI_CHAT_MODEL")
        or strip_codex_prefix(os.environ.get("OPENAI_RAG_MODEL", ""))
        or "gpt-4.1-mini"
    )


def source_label(source_type: str) -> str:
    if source_type == "pastorwood_devotional":
        return "weekly devotional"
    if source_type == "pastorwood_resource":
        return "resource writing"
    return source_type.replace("_", " ")


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def truncate_source(text: str, max_chars: int) -> str:
    normalized = text.strip()
    if len(normalized) <= max_chars:
        return normalized
    return normalized[:max_chars].rsplit(" ", 1)[0].rstrip() + "\n\n[Text truncated for summary input.]"


def select_pending_posts(
    conn: psycopg.Connection,
    source_type: str,
    limit: int,
    force: bool,
) -> list[dict[str, Any]]:
    sql = """
        select
          post_id,
          source_type,
          title,
          slug,
          source_url,
          publish_date::text as publish_date,
          text,
          content_hash,
          summary,
          summary_model,
          summary_input_hash
        from pastorwood_posts
        where text <> ''
    """
    params: list[Any] = []
    if source_type != "all":
        sql += " and source_type = %s"
        params.append(source_type)
    if not force:
        sql += """
          and (
            summary = ''
            or summary_model = ''
            or summary_input_hash is distinct from content_hash
          )
        """
    sql += " order by publish_date asc nulls last, post_id asc"
    if limit > 0:
        sql += " limit %s"
        params.append(limit)

    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def build_messages(row: dict[str, Any], max_source_chars: int, retry: bool) -> list[dict[str, str]]:
    text = truncate_source(str(row.get("text") or ""), max_source_chars)
    title = normalize_text(str(row.get("title") or "Untitled"))
    publish_date = str(row.get("publish_date") or "Undated")
    writing_type = source_label(str(row.get("source_type") or ""))
    retry_note = (
        "\nThe previous draft was too close to the opening wording. Rewrite it from scratch with different wording."
        if retry
        else ""
    )

    return [
        {
            "role": "system",
            "content": (
                "You write concise, faithful summaries of Christian devotional writings. "
                "You preserve the meaning of the source, avoid adding claims not present in the text, "
                "and paraphrase instead of copying the author's sentences."
            ),
        },
        {
            "role": "user",
            "content": (
                "Write a 2 to 4 sentence generated summary of this Pastor Wood writing.\n"
                "Requirements:\n"
                "- Paraphrase the main point; do not quote or closely copy the opening sentence or paragraph.\n"
                "- Include the central Scripture, doctrine, or pastoral application when the text makes it clear.\n"
                "- Keep it under 120 words.\n"
                "- Return one plain paragraph with no heading, bullets, citations, or markdown."
                f"{retry_note}\n\n"
                f"Title: {title}\n"
                f"Type: {writing_type}\n"
                f"Date: {publish_date}\n\n"
                f"Writing text:\n{text}"
            ),
        },
    ]


def chat_request(provider: str, model: str, messages: list[dict[str, str]], timeout: int) -> dict[str, Any]:
    if provider == "silo":
        token = os.environ.get("SILO_TEMP_KEY", "")
        if not token:
            raise RuntimeError("SILO_TEMP_KEY is required for --provider silo")
        url = os.environ.get("SILO_CHAT_URL") or "http://192.168.1.195:4041/v1/chat/completions"
        payload: dict[str, Any] = {
            "model": model,
            "backend_mode": "codex-direct",
            "messages": messages,
            "stream": False,
        }
    else:
        token = os.environ.get("OPENAI_API_KEY", "")
        if not token:
            raise RuntimeError("OPENAI_API_KEY is required for --provider openai")
        url = os.environ.get("OPENAI_CHAT_URL") or "https://api.openai.com/v1/chat/completions"
        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.2,
        }

    data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")[:1200]
        raise RuntimeError(f"{provider} chat request failed ({exc.code}): {details}") from exc


def extract_chat_text(body: dict[str, Any]) -> str:
    choices = body.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str):
                return content.strip()
            if isinstance(content, list):
                pieces = [
                    part.get("text", "")
                    for part in content
                    if isinstance(part, dict) and isinstance(part.get("text"), str)
                ]
                return "\n".join(pieces).strip()
        text = choices[0].get("text") if isinstance(choices[0], dict) else None
        if isinstance(text, str):
            return text.strip()

    output_text = body.get("output_text")
    if isinstance(output_text, str):
        return output_text.strip()

    raise RuntimeError("chat response did not contain summary text")


def word_tokens(value: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", value.lower())


def first_sentence(value: str) -> str:
    match = re.search(r"(.{80,}?[.!?])\s", normalize_text(value))
    if match:
        return match.group(1).strip()
    return normalize_text(value)[:180]


def too_close_to_opening(summary: str, text: str) -> bool:
    summary_words = word_tokens(summary)
    opening_words = word_tokens(text)[:80]
    if len(summary_words) >= 10 and summary_words[:10] == opening_words[:10]:
        return True

    opening_sentence = first_sentence(text).lower()
    if len(opening_sentence) >= 90 and opening_sentence[:90] in summary.lower():
        return True

    for size in (14, 12, 10):
        if len(summary_words) < size:
            continue
        phrase = " ".join(summary_words[:size])
        opening = " ".join(opening_words)
        if phrase and phrase in opening:
            return True

    return False


def clean_summary(value: str) -> str:
    cleaned = normalize_text(value.strip().strip('"').strip("'"))
    return cleaned[:1200].strip()


def summarize_post(
    row: dict[str, Any],
    provider: str,
    model: str,
    max_source_chars: int,
    timeout: int,
) -> str:
    for attempt in range(2):
        body = chat_request(provider, model, build_messages(row, max_source_chars, retry=attempt > 0), timeout)
        summary = clean_summary(extract_chat_text(body))
        if summary and not too_close_to_opening(summary, str(row.get("text") or "")):
            return summary
    raise RuntimeError("generated summary was too close to the opening wording")


def update_summary(conn: psycopg.Connection, row: dict[str, Any], summary: str, model: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            update pastorwood_posts
            set
              summary = %s,
              summary_model = %s,
              summary_input_hash = content_hash,
              summary_updated_at = now(),
              updated_at = now()
            where post_id = %s
            """,
            (summary, model, row["post_id"]),
        )
        return cur.rowcount


def main() -> int:
    args = parse_args()
    if args.limit < 0:
        raise SystemExit("--limit must be zero or greater")
    if args.max_source_chars < 1000:
        raise SystemExit("--max-source-chars must be at least 1000")

    load_env(args.env_file)
    provider = resolve_provider(args.provider)
    model = args.model or default_model(provider)

    counts: dict[str, Any] = {
        "provider": provider,
        "model": model,
        "source_type": args.source_type,
        "selected": 0,
        "summarized": 0,
        "failed": 0,
        "dry_run": args.dry_run,
    }

    with psycopg.connect(dsn()) as conn:
        rows = select_pending_posts(conn, args.source_type, args.limit, args.force)
        counts["selected"] = len(rows)
        if args.dry_run or not rows:
            print(json.dumps(counts, indent=2, sort_keys=True))
            return 0

        for row in rows:
            label = f"{row['post_id']} {row['title']}"
            try:
                summary = summarize_post(row, provider, model, args.max_source_chars, args.timeout_seconds)
                counts["summarized"] += update_summary(conn, row, summary, model)
                conn.commit()
                print(f"summarized {label}", file=sys.stderr)
            except Exception as error:
                conn.rollback()
                counts["failed"] += 1
                print(f"failed {label}: {error}", file=sys.stderr)
            if args.sleep_seconds > 0:
                time.sleep(args.sleep_seconds)

    print(json.dumps(counts, indent=2, sort_keys=True))
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        raise SystemExit(130)
