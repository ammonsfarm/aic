#!/usr/bin/env python3
"""Sync Podtrac SQLite stats into the AIC Postgres serving database."""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
from dataclasses import dataclass
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable

import psycopg


DEFAULT_PODTRAC_DB = Path("podtrac_stats.sqlite3")


@dataclass(frozen=True)
class EpisodeCandidate:
    track_id: str
    title: str
    publish_date: str
    normalized_title: str


@dataclass(frozen=True)
class EpisodeMatch:
    track_id: str | None
    title: str
    publish_date: str
    status: str
    method: str
    score: float | None
    notes: str


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
    parser = argparse.ArgumentParser(description="Sync Podtrac SQLite stats into Postgres.")
    parser.add_argument("--podtrac-db", type=Path, default=DEFAULT_PODTRAC_DB)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument(
        "--fuzzy-threshold",
        type=float,
        default=0.91,
        help="Minimum title similarity for fallback fuzzy matching.",
    )
    return parser.parse_args()


def rows(conn: sqlite3.Connection, query: str) -> Iterable[sqlite3.Row]:
    conn.row_factory = sqlite3.Row
    yield from conn.execute(query)


def chunks(items: list[tuple], size: int) -> Iterable[list[tuple]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def json_value(value: str, default: object) -> str:
    if value is None or value == "":
        return json.dumps(default)
    try:
        json.loads(value)
        return value
    except json.JSONDecodeError:
        return json.dumps(value)


def normalize_title(value: str) -> str:
    title = (value or "").lower().replace("_", ":").replace("&", " and ")
    title = re.sub(r"\bprogram\s+for\s+\d{1,2}/\d{1,2}/\d{2,4}\s*", "", title)
    title = re.sub(r"\b(best)\s+of\b", "best of", title)
    title = re.sub(r"[^a-z0-9]+", " ", title)
    return " ".join(title.split())


def date_distance(left: str, right: str) -> int:
    try:
        return abs((date.fromisoformat(left) - date.fromisoformat(right)).days)
    except ValueError:
        return 999999


def load_episode_candidates(pg: psycopg.Connection) -> dict[str, list[EpisodeCandidate]]:
    by_title: dict[str, list[EpisodeCandidate]] = {}
    for track_id, title, publish_date in pg.execute("select track_id, title, publish_date from episodes"):
        normalized = normalize_title(title)
        by_title.setdefault(normalized, []).append(
            EpisodeCandidate(
                track_id=str(track_id),
                title=title or "",
                publish_date=publish_date or "",
                normalized_title=normalized,
            )
        )
    return by_title


def choose_match(
    podtrac_title: str,
    podtrac_date: str,
    by_title: dict[str, list[EpisodeCandidate]],
    fuzzy_threshold: float,
) -> EpisodeMatch:
    normalized = normalize_title(podtrac_title)
    exact = by_title.get(normalized, [])
    if len(exact) == 1:
        candidate = exact[0]
        return EpisodeMatch(candidate.track_id, candidate.title, candidate.publish_date, "matched", "normalized_title", 1.0, "")
    if len(exact) > 1:
        candidate = sorted(exact, key=lambda item: date_distance(podtrac_date, item.publish_date))[0]
        return EpisodeMatch(
            candidate.track_id,
            candidate.title,
            candidate.publish_date,
            "matched",
            "normalized_title_nearest_date",
            1.0,
            f"{len(exact)} episodes shared the normalized title; chose nearest publish_date.",
        )

    best: tuple[float, EpisodeCandidate] | None = None
    for candidates in by_title.values():
        for candidate in candidates:
            score = SequenceMatcher(None, normalized, candidate.normalized_title).ratio()
            if best is None or score > best[0]:
                best = (score, candidate)
    if best and best[0] >= fuzzy_threshold:
        candidate = best[1]
        return EpisodeMatch(
            candidate.track_id,
            candidate.title,
            candidate.publish_date,
            "matched",
            "fuzzy_title",
            best[0],
            "Matched by title similarity fallback.",
        )
    score = best[0] if best else None
    notes = ""
    if best:
        notes = f"Best candidate was {best[1].track_id} at score {score:.5f}."
    return EpisodeMatch(None, "", "", "unmatched", "", score, notes)


def sync_import_runs(sqlite_conn: sqlite3.Connection, pg: psycopg.Connection, batch_size: int) -> int:
    payload = [
        (
            row["Run_ID"],
            row["Imported_At"],
            json_value(row["Source_Har_Files"], []),
            json_value(row["Summary"], {}),
        )
        for row in rows(sqlite_conn, "select * from Import_Run order by Run_ID")
    ]
    sql = """
        insert into podtrac_import_runs(run_id, imported_at, source_har_files, summary, updated_at)
        values (%s, %s, %s::jsonb, %s::jsonb, now())
        on conflict(run_id) do update set
            imported_at=excluded.imported_at,
            source_har_files=excluded.source_har_files,
            summary=excluded.summary,
            updated_at=now()
    """
    with pg.cursor() as cur:
        for batch in chunks(payload, batch_size):
            cur.executemany(sql, batch)
    return len(payload)


def sync_metadata(sqlite_conn: sqlite3.Connection, pg: psycopg.Connection, batch_size: int) -> int:
    payload = [(row["Key"], json_value(row["Value"], "")) for row in rows(sqlite_conn, "select * from Import_Metadata")]
    sql = """
        insert into podtrac_import_metadata(key, value, updated_at)
        values (%s, %s::jsonb, now())
        on conflict(key) do update set value=excluded.value, updated_at=now()
    """
    with pg.cursor() as cur:
        for batch in chunks(payload, batch_size):
            cur.executemany(sql, batch)
    return len(payload)


def sync_dimensions(sqlite_conn: sqlite3.Connection, pg: psycopg.Connection, batch_size: int) -> tuple[int, int]:
    countries = [
        (row["Country_ID"], row["Name"], row["Import_Run_ID"], row["Imported_At"])
        for row in rows(sqlite_conn, "select * from Country order by Country_ID")
    ]
    clients = [
        (row["Client_ID"], row["Name"], row["Import_Run_ID"], row["Imported_At"])
        for row in rows(sqlite_conn, "select * from Client order by Client_ID")
    ]
    country_sql = """
        insert into podtrac_countries(podtrac_country_id, name, import_run_id, imported_at, updated_at)
        values (%s, %s, %s, %s, now())
        on conflict(podtrac_country_id) do update set
            name=excluded.name,
            import_run_id=excluded.import_run_id,
            imported_at=excluded.imported_at,
            updated_at=now()
    """
    client_sql = """
        insert into podtrac_clients(podtrac_client_id, name, import_run_id, imported_at, updated_at)
        values (%s, %s, %s, %s, now())
        on conflict(podtrac_client_id) do update set
            name=excluded.name,
            import_run_id=excluded.import_run_id,
            imported_at=excluded.imported_at,
            updated_at=now()
    """
    with pg.cursor() as cur:
        for batch in chunks(countries, batch_size):
            cur.executemany(country_sql, batch)
        for batch in chunks(clients, batch_size):
            cur.executemany(client_sql, batch)
    return len(countries), len(clients)


def sync_episodes(sqlite_conn: sqlite3.Connection, pg: psycopg.Connection, batch_size: int, fuzzy_threshold: float) -> tuple[int, int]:
    candidates = load_episode_candidates(pg)
    payload = []
    matched = 0
    for row in rows(sqlite_conn, "select * from Episode order by Episode_ID"):
        match = choose_match(row["Title"], row["Date"], candidates, fuzzy_threshold)
        if match.status == "matched":
            matched += 1
        payload.append(
            (
                row["Episode_ID"],
                row["Title"],
                row["Date"],
                row["Import_Run_ID"],
                row["Imported_At"],
                match.track_id,
                match.title,
                match.publish_date,
                match.status,
                match.method,
                match.score,
                match.notes,
                normalize_title(row["Title"]),
            )
        )
    sql = """
        insert into podtrac_episodes(
            podtrac_episode_id, title, publish_date, import_run_id, imported_at,
            track_id, matched_episode_title, matched_episode_publish_date,
            match_status, match_method, match_score, match_notes, title_normalized, updated_at
        ) values (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now()
        )
        on conflict(podtrac_episode_id) do update set
            title=excluded.title,
            publish_date=excluded.publish_date,
            import_run_id=excluded.import_run_id,
            imported_at=excluded.imported_at,
            track_id=excluded.track_id,
            matched_episode_title=excluded.matched_episode_title,
            matched_episode_publish_date=excluded.matched_episode_publish_date,
            match_status=excluded.match_status,
            match_method=excluded.match_method,
            match_score=excluded.match_score,
            match_notes=excluded.match_notes,
            title_normalized=excluded.title_normalized,
            updated_at=now()
    """
    with pg.cursor() as cur:
        for batch in chunks(payload, batch_size):
            cur.executemany(sql, batch)
    return len(payload), matched


def sync_activity(sqlite_conn: sqlite3.Connection, pg: psycopg.Connection, batch_size: int) -> tuple[int, int, int]:
    daily = [
        (row["Date"], row["Episode"], row["Count"], row["Import_Run_ID"], row["Imported_At"])
        for row in rows(sqlite_conn, "select * from Daily_Activity order by Date, Episode")
    ]
    countries = [
        (row["Date"], row["Country"], row["Count"], row["Import_Run_ID"], row["Imported_At"])
        for row in rows(sqlite_conn, "select * from Activity_By_Country order by Date, Country")
    ]
    clients = [
        (row["Date"], row["Client"], row["Count"], row["Import_Run_ID"], row["Imported_At"])
        for row in rows(sqlite_conn, "select * from Activity_By_Client order by Date, Client")
    ]
    daily_sql = """
        insert into podtrac_daily_activity(activity_date, podtrac_episode_id, download_count, import_run_id, imported_at, updated_at)
        values (%s, %s, %s, %s, %s, now())
        on conflict(activity_date, podtrac_episode_id) do update set
            download_count=excluded.download_count,
            import_run_id=excluded.import_run_id,
            imported_at=excluded.imported_at,
            updated_at=now()
    """
    country_sql = """
        insert into podtrac_activity_by_country(activity_date, podtrac_country_id, download_count, import_run_id, imported_at, updated_at)
        values (%s, %s, %s, %s, %s, now())
        on conflict(activity_date, podtrac_country_id) do update set
            download_count=excluded.download_count,
            import_run_id=excluded.import_run_id,
            imported_at=excluded.imported_at,
            updated_at=now()
    """
    client_sql = """
        insert into podtrac_activity_by_client(activity_date, podtrac_client_id, download_count, import_run_id, imported_at, updated_at)
        values (%s, %s, %s, %s, %s, now())
        on conflict(activity_date, podtrac_client_id) do update set
            download_count=excluded.download_count,
            import_run_id=excluded.import_run_id,
            imported_at=excluded.imported_at,
            updated_at=now()
    """
    with pg.cursor() as cur:
        for batch in chunks(daily, batch_size):
            cur.executemany(daily_sql, batch)
        for batch in chunks(countries, batch_size):
            cur.executemany(country_sql, batch)
        for batch in chunks(clients, batch_size):
            cur.executemany(client_sql, batch)
    return len(daily), len(countries), len(clients)


def main() -> int:
    args = parse_args()
    load_env(args.env_file)
    sqlite_conn = sqlite3.connect(args.podtrac_db)
    sqlite_conn.row_factory = sqlite3.Row
    counts: dict[str, int] = {}
    try:
        with psycopg.connect(dsn()) as pg:
            run_id = pg.execute(
                "insert into podtrac_sync_runs(source_sqlite_path) values (%s) returning id",
                (str(args.podtrac_db),),
            ).fetchone()[0]
            try:
                counts["import_runs"] = sync_import_runs(sqlite_conn, pg, args.batch_size)
                counts["metadata"] = sync_metadata(sqlite_conn, pg, args.batch_size)
                counts["countries"], counts["clients"] = sync_dimensions(sqlite_conn, pg, args.batch_size)
                counts["episodes"], counts["matched_episodes"] = sync_episodes(
                    sqlite_conn, pg, args.batch_size, args.fuzzy_threshold
                )
                counts["unmatched_episodes"] = counts["episodes"] - counts["matched_episodes"]
                (
                    counts["daily_activity"],
                    counts["country_activity"],
                    counts["client_activity"],
                ) = sync_activity(sqlite_conn, pg, args.batch_size)
                pg.execute(
                    """
                    update podtrac_sync_runs set completed_at=now(), status='completed',
                        import_runs_count=%s,
                        metadata_count=%s,
                        episodes_count=%s,
                        countries_count=%s,
                        clients_count=%s,
                        daily_activity_count=%s,
                        country_activity_count=%s,
                        client_activity_count=%s,
                        matched_episodes_count=%s,
                        unmatched_episodes_count=%s
                    where id=%s
                    """,
                    (
                        counts["import_runs"],
                        counts["metadata"],
                        counts["episodes"],
                        counts["countries"],
                        counts["clients"],
                        counts["daily_activity"],
                        counts["country_activity"],
                        counts["client_activity"],
                        counts["matched_episodes"],
                        counts["unmatched_episodes"],
                        run_id,
                    ),
                )
                pg.commit()
            except Exception as error:
                pg.execute(
                    "update podtrac_sync_runs set completed_at=now(), status='failed', error=%s where id=%s",
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
