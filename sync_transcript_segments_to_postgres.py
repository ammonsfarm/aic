#!/usr/bin/env python3
"""Load Gemini transcript JSON segments into Postgres for transcript reading."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from typing import Any, Iterable

import psycopg

from scripts.aic_database_env import CANONICAL_AIC_ENV, database_dsn, load_canonical_aic_env


DEFAULT_TRANSCRIPT_DIR = Path("/home/ammonsfarm/gemini-transcribe")
TRACK_ID_PATTERN = re.compile(r"^(?:[0-9]+|sa_[0-9]+|wp-sermon:[0-9]+|cms_[a-z0-9][a-z0-9_-]{0,62})$")


def load_env(path: Path) -> None:
    load_canonical_aic_env(path)


def dsn() -> str:
    return database_dsn(application_name="aic-transcript-segment-sync")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync transcript JSON segments into the AIC Postgres serving DB.")
    parser.add_argument("--transcript-dir", type=Path, default=DEFAULT_TRANSCRIPT_DIR)
    parser.add_argument("--env-file", type=Path, default=CANONICAL_AIC_ENV)
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--commit-every", type=int, default=100)
    parser.add_argument("--limit", type=int, default=0, help="Optional max transcript files to process.")
    parser.add_argument("--track-id", action="append", default=[], help="Process one track id. May be repeated.")
    return parser.parse_args()


def json_text(value: Any, default: Any) -> str:
    if value is None:
        value = default
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def clean_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def time_to_seconds(value: Any) -> float | None:
    if not isinstance(value, str) or not value.strip():
        return None

    parts = value.strip().split(":")
    try:
        numbers = [float(part) for part in parts]
    except ValueError:
        return None

    if len(numbers) == 3:
        hours, minutes, seconds = numbers
    elif len(numbers) == 2:
        hours = 0
        minutes, seconds = numbers
    elif len(numbers) == 1:
        hours = 0
        minutes = 0
        seconds = numbers[0]
    else:
        return None

    return hours * 3600 + minutes * 60 + seconds


def transcript_paths(transcript_dir: Path, track_ids: list[str], limit: int) -> list[Path]:
    if track_ids:
        paths = [
            transcript_dir / f"{track_id}.json"
            for track_id in track_ids
            if TRACK_ID_PATTERN.fullmatch(track_id)
        ]
    else:
        paths = sorted(transcript_dir.glob("*.json"))

    paths = [path for path in paths if path.exists() and TRACK_ID_PATTERN.fullmatch(path.stem)]
    if limit > 0:
        return paths[:limit]
    return paths


def chunks(items: list[tuple], size: int) -> Iterable[list[tuple]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def read_transcript(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"{path} does not contain a JSON object")
    return data


def episode_payload(track_id: str, data: dict[str, Any], source_file: str) -> tuple[str, str, str, str, str, str, str]:
    episode = data.get("episode") if isinstance(data.get("episode"), dict) else {}
    return (
        clean_text(episode.get("track_id")) or track_id,
        clean_text(episode.get("title")) or f"Episode {track_id}",
        clean_text(episode.get("publish_date")),
        clean_text(episode.get("album")),
        clean_text(episode.get("category")),
        clean_text(episode.get("detail")),
        source_file,
    )


def normalize_reference_name(reference: Any) -> str:
    if isinstance(reference, str):
        return reference.strip()
    if isinstance(reference, dict):
        for key in ("reference", "name", "title", "text"):
            value = reference.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def reference_row(
    track_id: str,
    reference_type: str,
    source_scope: str,
    reference_index: int,
    reference: Any,
    segment_index: int | None = None,
    segment_text: str = "",
) -> tuple:
    raw = reference if isinstance(reference, dict) else {"reference": normalize_reference_name(reference)}
    ref_name = normalize_reference_name(reference)
    start_time = clean_text(raw.get("start_time")) if isinstance(raw, dict) else ""
    end_time = clean_text(raw.get("end_time")) if isinstance(raw, dict) else ""
    context = clean_text(raw.get("context")) if isinstance(raw, dict) else ""
    text = clean_text(raw.get("text")) if isinstance(raw, dict) else ""

    if not text and segment_text:
        text = segment_text

    segment_key = "episode" if segment_index is None else str(segment_index).zfill(6)
    reference_id = f"{track_id}:{source_scope}:{reference_type}:{segment_key}:{reference_index:06d}"

    return (
        reference_id,
        track_id,
        segment_index,
        reference_type,
        source_scope,
        ref_name,
        start_time,
        end_time,
        time_to_seconds(start_time),
        time_to_seconds(end_time),
        context,
        text,
        json_text(raw, {}),
    )


def build_rows(path: Path) -> tuple[tuple, list[tuple], list[tuple]]:
    track_id = path.stem
    data = read_transcript(path)
    source_file = str(path)
    segments = data.get("segments")
    if not isinstance(segments, list):
        segments = []

    segment_rows: list[tuple] = []
    reference_rows: list[tuple] = []
    for index, segment in enumerate(segments):
        if not isinstance(segment, dict):
            continue

        start_time = clean_text(segment.get("start_time"))
        end_time = clean_text(segment.get("end_time"))
        bible_references = segment.get("bible_references") if isinstance(segment.get("bible_references"), list) else []
        other_references = segment.get("other_references") if isinstance(segment.get("other_references"), list) else []
        text = clean_text(segment.get("text"))

        segment_rows.append(
            (
                f"{track_id}:{index:06d}",
                track_id,
                index,
                start_time,
                end_time,
                time_to_seconds(start_time),
                time_to_seconds(end_time),
                clean_text(segment.get("speaker_id")),
                clean_text(segment.get("speaker_name")),
                clean_text(segment.get("segment_type")) or "speech",
                text,
                json_text(bible_references, []),
                json_text(other_references, []),
                source_file,
                json_text(segment, {}),
            )
        )

        for ref_index, reference in enumerate(bible_references):
            if normalize_reference_name(reference):
                reference_rows.append(
                    reference_row(track_id, "bible", "segment", ref_index, reference, index, text)
                )
        for ref_index, reference in enumerate(other_references):
            if normalize_reference_name(reference):
                reference_rows.append(
                    reference_row(track_id, "other", "segment", ref_index, reference, index, text)
                )

    top_bible = data.get("bible_references") if isinstance(data.get("bible_references"), list) else []
    top_other = data.get("other_references") if isinstance(data.get("other_references"), list) else []
    for ref_index, reference in enumerate(top_bible):
        if normalize_reference_name(reference):
            reference_rows.append(reference_row(track_id, "bible", "episode", ref_index, reference))
    for ref_index, reference in enumerate(top_other):
        if normalize_reference_name(reference):
            reference_rows.append(reference_row(track_id, "other", "episode", ref_index, reference))

    return episode_payload(track_id, data, source_file), segment_rows, reference_rows


def sync_episode(cur: psycopg.Cursor, payload: tuple) -> None:
    cur.execute(
        """
        insert into episodes(track_id, title, publish_date, album, category, detail, source_file, updated_at)
        values (%s, %s, %s, %s, %s, %s, %s, now())
        on conflict(track_id) do update set
            title=coalesce(nullif(excluded.title, ''), episodes.title),
            publish_date=coalesce(nullif(excluded.publish_date, ''), episodes.publish_date),
            album=coalesce(nullif(excluded.album, ''), episodes.album),
            category=coalesce(nullif(excluded.category, ''), episodes.category),
            detail=coalesce(nullif(excluded.detail, ''), episodes.detail),
            source_file=coalesce(nullif(episodes.source_file, ''), excluded.source_file),
            updated_at=now()
        """,
        payload,
    )


def sync_transcript_file(pg: psycopg.Connection, path: Path, batch_size: int) -> tuple[int, int]:
    episode, segment_rows, reference_rows = build_rows(path)
    track_id = episode[0]

    with pg.cursor() as cur:
        sync_episode(cur, episode)
        cur.execute("delete from transcript_references where track_id = %s", (track_id,))
        cur.execute("delete from transcript_segments where track_id = %s", (track_id,))

        segment_sql = """
            insert into transcript_segments(
                segment_id, track_id, segment_index, start_time, end_time,
                start_seconds, end_seconds, speaker_id, speaker_name, segment_type,
                text, bible_references, other_references, source_file, raw_segment,
                updated_at
            ) values (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s::jsonb, %s::jsonb, %s, %s::jsonb, now()
            )
        """
        for batch in chunks(segment_rows, batch_size):
            cur.executemany(segment_sql, batch)

        reference_sql = """
            insert into transcript_references(
                reference_id, track_id, segment_index, reference_type, source_scope,
                reference, start_time, end_time, start_seconds, end_seconds,
                context, text, raw_reference, updated_at
            ) values (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, now()
            )
        """
        for batch in chunks(reference_rows, batch_size):
            cur.executemany(reference_sql, batch)

    return len(segment_rows), len(reference_rows)


def main() -> int:
    args = parse_args()
    load_env(args.env_file)
    paths = transcript_paths(args.transcript_dir, args.track_id, args.limit)
    if not paths:
        raise SystemExit(f"No transcript JSON files found in {args.transcript_dir}")

    counts = {"files": 0, "segments": 0, "references": 0, "failed": 0}
    with psycopg.connect(dsn()) as pg:
        for path in paths:
            try:
                segment_count, reference_count = sync_transcript_file(pg, path, args.batch_size)
            except Exception as error:
                pg.rollback()
                counts["failed"] += 1
                print(f"failed {path.name}: {error}")
                continue

            counts["files"] += 1
            counts["segments"] += segment_count
            counts["references"] += reference_count

            if counts["files"] % args.commit_every == 0:
                pg.commit()
                print(json.dumps(counts, sort_keys=True))

        pg.commit()

    print(json.dumps(counts, indent=2, sort_keys=True))
    return 0 if counts["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
