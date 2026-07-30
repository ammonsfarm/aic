#!/usr/bin/env python3
"""Fetch Podtrac daily stats and upsert them directly into Postgres.

This is the current Podtrac ingest path. It intentionally does not write or
stage through SQLite. The default authentication mode uses the user's signed-in
Chrome session; a local DevTools "Copy as cURL" capture is still available as a
fallback with --auth-mode curl.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psycopg


ACCOUNT_ID = "T54MteRRqlhP"
SHOW_ID = "2AXMI-vyKsTY"
BASE_URL = f"https://publisher.podtrac.com/api/{ACCOUNT_ID}/measurement/reports/{SHOW_ID}"
FEED_FILTER = f"feedFilter[]={SHOW_ID}"
REPORTS = ("episode", "country", "client")
DEFAULT_CURL_FILE = Path("podtrac-auth.curl")
DEFAULT_ENV_FILE = Path(".env")
DEFAULT_LOG_DIR = Path("run_logs")
SERVER_AIC_ROOT = Path("/mnt/storage/aic")
SERVER_PODCAST_ROOT = Path("/mnt/storage/aic_podcast")
SERVER_ENV_FILE = SERVER_AIC_ROOT / ".env"
SERVER_CURL_FILE = SERVER_PODCAST_ROOT / "podtrac-auth.curl"
SERVER_LOG_DIR = SERVER_PODCAST_ROOT / "run_logs"
SERVER_PYTHON = SERVER_AIC_ROOT / ".venv-pg/bin/python"
SERVER_RUNNER = SERVER_AIC_ROOT / "ops/podtrac/run_daily_podtrac_ingest.py"
EXPECTED_DB_HOST = "192.168.1.106"
EXPECTED_DB_PORT = "5432"
DATABASE_ENV_KEYS = ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD")
LIBPQ_ROUTING_ENV_KEYS = (
    "PGHOST",
    "PGHOSTADDR",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
    "PGPASSFILE",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGOPTIONS",
    "PGTARGETSESSIONATTRS",
    "PGSSLMODE",
)
DATABASE_ROUTING_ENV_KEYS = (*LIBPQ_ROUTING_ENV_KEYS, "DATABASE_URL")
MAX_ATTEMPT_ERROR_LENGTH = 240


class PodtracRequestError(RuntimeError):
    """A provider request failed without retaining response or credential data."""


class PodtracAuthenticationError(PodtracRequestError):
    def __init__(self, status: int):
        if status not in {401, 403}:
            raise ValueError("Podtrac authentication status must be HTTP 401 or 403.")
        self.status = status
        super().__init__(f"Podtrac authentication failed with HTTP {status}.")


def is_database_routing_key(key: str) -> bool:
    return key == "DATABASE_URL" or key.startswith("PG")


@dataclass(frozen=True)
class ReportPayload:
    report: str
    matrix: dict
    row_totals: list[dict]
    cells: dict[str, dict[str, int]]


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
    if not path.is_file():
        raise RuntimeError(f"Declared Podtrac environment file is missing: {path}")
    values: dict[str, str] = {}
    sensitive_keys = {*DATABASE_ENV_KEYS, *DATABASE_ROUTING_ENV_KEYS}
    seen_sensitive: set[str] = set()
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if line.startswith("export "):
            line = line.removeprefix("export ").lstrip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if is_database_routing_key(key):
            raise RuntimeError(f"Declared Podtrac environment must not contain database routing key: {key}")
        if key in sensitive_keys:
            if key in seen_sensitive:
                raise RuntimeError(f"Declared Podtrac environment contains duplicate sensitive key: {key}")
            seen_sensitive.add(key)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value

    missing = [key for key in DATABASE_ENV_KEYS if not values.get(key)]
    if missing:
        raise RuntimeError("Declared Podtrac environment is missing database settings: " + ", ".join(missing))
    if values["DB_HOST"] != EXPECTED_DB_HOST or values["DB_PORT"] != EXPECTED_DB_PORT:
        raise RuntimeError(
            f"Podtrac ingest must use the existing AIC PostgreSQL target at {EXPECTED_DB_HOST}:{EXPECTED_DB_PORT}."
        )

    for key in list(os.environ):
        if key in DATABASE_ENV_KEYS or is_database_routing_key(key):
            os.environ.pop(key, None)
    for key in DATABASE_ENV_KEYS:
        os.environ[key] = values[key]
    for key, value in values.items():
        if key not in (*DATABASE_ENV_KEYS, *DATABASE_ROUTING_ENV_KEYS):
            os.environ.setdefault(key, value)


def dsn() -> str:
    missing = [key for key in DATABASE_ENV_KEYS if not os.environ.get(key)]
    if missing:
        raise RuntimeError("Podtrac database environment has not been loaded: " + ", ".join(missing))
    if os.environ["DB_HOST"] != EXPECTED_DB_HOST or os.environ["DB_PORT"] != EXPECTED_DB_PORT:
        raise RuntimeError(
            f"Podtrac ingest must use the existing AIC PostgreSQL target at {EXPECTED_DB_HOST}:{EXPECTED_DB_PORT}."
        )
    inherited_routing = sorted(key for key in os.environ if is_database_routing_key(key))
    if inherited_routing:
        raise RuntimeError("Independent libpq routing settings are forbidden: " + ", ".join(inherited_routing))

    def quote(value: str) -> str:
        return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"

    settings = {
        "host": os.environ["DB_HOST"],
        "port": os.environ["DB_PORT"],
        "dbname": os.environ["DB_NAME"],
        "user": os.environ["DB_USER"],
        "password": os.environ["DB_PASSWORD"],
        "application_name": "aic-podtrac-daily-ingest",
    }
    return " ".join(f"{key}={quote(value)}" for key, value in settings.items())


def connect_pg(args: argparse.Namespace) -> psycopg.Connection:
    last_error: Exception | None = None
    for attempt in range(1, args.db_connect_retries + 1):
        try:
            return psycopg.connect(dsn(), connect_timeout=args.db_connect_timeout)
        except psycopg.OperationalError as error:
            last_error = error
            if attempt >= args.db_connect_retries:
                break
            time.sleep(args.db_connect_sleep)
    assert last_error is not None
    raise last_error


def parse_headers_from_curl(path: Path) -> dict[str, str]:
    text = path.read_text()
    headers: dict[str, str] = {}
    header_pattern = re.compile(r"""(?:-H|--header)\s+(['"])(?P<header>.*?)(?<!\\)\1""", re.S)
    for match in header_pattern.finditer(text):
        header = match.group("header").replace("\\\n", "").replace("\\'", "'").replace('\\"', '"')
        if ":" not in header:
            continue
        name, value = header.split(":", 1)
        headers[name.strip()] = value.strip()

    cookie_match = re.search(r"""(?:-b|--cookie)\s+(['"])(?P<cookie>.*?)(?<!\\)\1""", text, re.S)
    if cookie_match:
        headers["Cookie"] = cookie_match.group("cookie").replace("\\\n", "").strip()

    headers.setdefault("Accept", "application/json, text/plain, */*")
    headers.setdefault("Content-Type", "application/json")
    if "Cookie" not in headers:
        raise RuntimeError(
            f"{path} does not include a Cookie header. Refresh it from an authenticated "
            "Podtrac Network request in Chrome using Copy as cURL."
        )
    return headers


def fetch_json(url: str, headers: dict[str, str], data: list[str] | None = None) -> dict:
    body = None
    method = "GET"
    request_headers = dict(headers)
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        method = "POST"
        request_headers["Content-Type"] = "application/json"
    request = Request(url, data=body, headers=request_headers, method=method)
    try:
        with urlopen(request, timeout=90) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        if error.code in {401, 403}:
            raise PodtracAuthenticationError(error.code) from error
        raise PodtracRequestError(f"Podtrac request failed with HTTP {error.code}.") from error
    except URLError as error:
        raise PodtracRequestError("Podtrac network request failed.") from error


def chrome_prepare_tab() -> None:
    dashboard_url = (
        f"https://publisher.podtrac.com/dashboard/{ACCOUNT_ID}/analytics/shows/{SHOW_ID}/"
        "downloads/episode/day"
    )
    script = f"""
tell application "Google Chrome"
  if (count of windows) = 0 then
    make new window
  end if
  set currentUrl to URL of active tab of front window
  if currentUrl does not start with "https://publisher.podtrac.com/" then
    set URL of active tab of front window to "{dashboard_url}"
  end if
end tell
"""
    subprocess.run(["osascript", "-e", script], check=True, text=True, capture_output=True)
    time.sleep(2)


def chrome_fetch_json(url: str, data: list[str] | None = None) -> dict:
    chrome_prepare_tab()
    method = "POST" if data is not None else "GET"
    body = json.dumps(data) if data is not None else None
    js = f"""
(() => {{
  try {{
    const xhr = new XMLHttpRequest();
    xhr.open({json.dumps(method)}, {json.dumps(url)}, false);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json, text/plain, */*");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send({json.dumps(body)});
    return JSON.stringify({{ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: xhr.responseText}});
  }} catch (error) {{
    return JSON.stringify({{ok: false, status: 0, text: String(error)}});
  }}
}})()
"""
    script = f"""
tell application "Google Chrome"
  return execute active tab of front window javascript {json.dumps(js)}
end tell
"""
    proc = subprocess.run(["osascript", "-e", script], check=True, text=True, capture_output=True)
    envelope = json.loads(proc.stdout)
    if not envelope.get("ok"):
        status = int(envelope.get("status") or 0)
        if status in {401, 403}:
            raise PodtracAuthenticationError(status)
        raise PodtracRequestError(f"Podtrac Chrome fetch failed with HTTP {status}.")
    return json.loads(str(envelope.get("text") or "{}"))


def fetch_report(
    report: str,
    start: date,
    end: date,
    headers: dict[str, str],
    sleep_seconds: float,
    auth_mode: str,
) -> ReportPayload:
    start_s = start.isoformat()
    end_s = end.isoformat()
    headers = dict(headers)
    headers["Referer"] = (
        f"https://publisher.podtrac.com/dashboard/{ACCOUNT_ID}/shows/{SHOW_ID}/"
        f"downloads/{report}/day/{start_s}/{end_s}"
    )
    matrix_url = (
        f"{BASE_URL}/{report}/day/matrix/{start_s}/{end_s}"
        f"?windowColumns=50&windowRows=50&{FEED_FILTER}"
    )
    fetch = chrome_fetch_json if auth_mode == "chrome" else lambda url, data=None: fetch_json(url, headers, data)
    matrix = fetch(matrix_url)
    row_window_count = int(matrix.get("rowWindowCount") or 0)
    window_rows = int(matrix.get("windowRows") or 50)
    row_totals: list[dict] = []
    cells: dict[str, dict[str, int]] = {}

    for row_window in range(row_window_count):
        row_url = (
            f"{BASE_URL}/{report}/day/row-totals/{start_s}/{end_s}/{row_window}"
            f"?windowColumns=50&windowRows={window_rows}&{FEED_FILTER}"
        )
        row_payload = fetch(row_url)
        rows = row_payload.get("rowTotals") or []
        row_totals.extend(rows)
        row_ids = [row["rowID"] for row in rows if row.get("rowID")]
        if row_ids:
            cells_url = f"{BASE_URL}/{report}/day/cells/{start_s}/{end_s}?{FEED_FILTER}"
            cell_payload = fetch(cells_url, row_ids)
            for row_id, date_counts in (cell_payload.get("cells") or {}).items():
                cells.setdefault(str(row_id), {})
                for raw_date, count in date_counts.items():
                    cells[str(row_id)][str(raw_date)[:10]] = int(count or 0)
        if sleep_seconds > 0:
            time.sleep(sleep_seconds)

    return ReportPayload(report=report, matrix=matrix, row_totals=row_totals, cells=cells)


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
    with pg.cursor() as cur:
        cur.execute("select track_id, title, publish_date from episodes")
        for track_id, title, publish_date in cur.fetchall():
            normalized = normalize_title(title or "")
            by_title.setdefault(normalized, []).append(
                EpisodeCandidate(
                    track_id=str(track_id),
                    title=title or "",
                    publish_date=str(publish_date or ""),
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
        item = exact[0]
        return EpisodeMatch(item.track_id, item.title, item.publish_date, "matched", "normalized_title", 1.0, "")
    if len(exact) > 1:
        item = sorted(exact, key=lambda candidate: date_distance(podtrac_date, candidate.publish_date))[0]
        return EpisodeMatch(
            item.track_id,
            item.title,
            item.publish_date,
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
        item = best[1]
        return EpisodeMatch(item.track_id, item.title, item.publish_date, "matched", "fuzzy_title", best[0], "")
    score = best[0] if best else None
    notes = f"Best candidate was {best[1].track_id} at score {score:.5f}." if best else ""
    return EpisodeMatch(None, "", "", "unmatched", "", score, notes)


def chunks(items: list[tuple], size: int) -> Iterable[list[tuple]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def latest_podtrac_date(pg: psycopg.Connection) -> date | None:
    with pg.cursor() as cur:
        cur.execute(
            """
            select greatest(
                coalesce((select max(activity_date) from podtrac_daily_activity), date '1900-01-01'),
                coalesce((select max(activity_date) from podtrac_activity_by_country), date '1900-01-01'),
                coalesce((select max(activity_date) from podtrac_activity_by_client), date '1900-01-01')
            )
            """
        )
        value = cur.fetchone()[0]
    if value and value.year > 1900:
        return value
    return None


def choose_window(pg: psycopg.Connection, args: argparse.Namespace) -> tuple[date, date]:
    end = date.fromisoformat(args.end) if args.end else date.today() - timedelta(days=args.available_lag_days)
    if args.start:
        start = date.fromisoformat(args.start)
    else:
        latest = latest_podtrac_date(pg)
        if latest:
            start = latest - timedelta(days=args.lookback_days)
        else:
            start = end - timedelta(days=args.max_window_days - 1)
    max_start = end - timedelta(days=args.max_window_days - 1)
    if start < max_start:
        start = max_start
    if start > end:
        raise SystemExit(f"No Podtrac date window to fetch: start {start} is after end {end}.")
    return start, end


def sync_attempt_source(start: date, end: date) -> str:
    return f"direct-podtrac-api:{start.isoformat()}:{end.isoformat()}"


def sync_attempt_failure_text(error: Exception, phase: str) -> str:
    if isinstance(error, PodtracAuthenticationError):
        return str(error)[:MAX_ATTEMPT_ERROR_LENGTH]

    safe_phase = "report fetch" if phase == "fetch" else "database import"
    error_kind = re.sub(r"[^A-Za-z0-9_.-]", "", type(error).__name__)[:80] or "Error"
    return f"Podtrac {safe_phase} failed ({error_kind})."[:MAX_ATTEMPT_ERROR_LENGTH]


def create_sync_attempt(args: argparse.Namespace, source: str) -> int:
    with connect_pg(args) as pg:
        with pg.cursor() as cur:
            sync_id = cur.execute(
                "insert into podtrac_sync_runs(source_sqlite_path) values (%s) returning id",
                (source,),
            ).fetchone()[0]
        pg.commit()
    return int(sync_id)


def fail_sync_attempt(args: argparse.Namespace, sync_id: int, error: Exception, phase: str) -> None:
    safe_error = sync_attempt_failure_text(error, phase)
    with connect_pg(args) as pg:
        with pg.cursor() as cur:
            cur.execute(
                """
                update podtrac_sync_runs
                   set completed_at=now(), status='failed', error=%s
                 where id=%s and status='running'
                """,
                (safe_error, sync_id),
            )
        pg.commit()


def run_id_from_now() -> int:
    # podtrac_import_runs.run_id is a PostgreSQL integer, so keep this under
    # the 32-bit ceiling while still making direct API runs easy to order.
    return int(time.time())


def upsert_podtrac(
    pg: psycopg.Connection,
    sync_id: int,
    payloads: dict[str, ReportPayload],
    start: date,
    end: date,
    source: str,
    fuzzy_threshold: float,
    batch_size: int,
) -> dict[str, int]:
    run_id = run_id_from_now()
    imported_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    by_title = load_episode_candidates(pg)
    counts: dict[str, int] = {
        "episodes": 0,
        "matched_episodes": 0,
        "unmatched_episodes": 0,
        "countries": 0,
        "clients": 0,
        "daily_activity": 0,
        "country_activity": 0,
        "client_activity": 0,
    }
    summary = {
        "mode": "direct_podtrac_api",
        "source": source,
        "date_window": {"start": start.isoformat(), "end": end.isoformat()},
        "reports": {
            name: {
                "total_rows": payload.matrix.get("totalRows"),
                "row_windows": payload.matrix.get("rowWindowCount"),
                "row_totals": len(payload.row_totals),
                "cell_rows": len(payload.cells),
            }
            for name, payload in payloads.items()
        },
    }

    with pg.cursor() as cur:
        cur.execute(
            """
            insert into podtrac_import_runs(run_id, imported_at, source_har_files, summary, updated_at)
            values (%s, %s, %s::jsonb, %s::jsonb, now())
            on conflict(run_id) do update set
                imported_at=excluded.imported_at,
                source_har_files=excluded.source_har_files,
                summary=excluded.summary,
                updated_at=now()
            """,
            (run_id, imported_at, json.dumps([source]), json.dumps(summary, sort_keys=True)),
        )
        # Delete the fetched date window after all reports have been fetched.
        cur.execute("delete from podtrac_daily_activity where activity_date between %s and %s", (start, end))
        cur.execute("delete from podtrac_activity_by_country where activity_date between %s and %s", (start, end))
        cur.execute("delete from podtrac_activity_by_client where activity_date between %s and %s", (start, end))

        episodes_payload = []
        for row in payloads["episode"].row_totals:
            podtrac_id = str(row["rowID"])
            title = row.get("title") or podtrac_id
            publish_date = str(row.get("publicationDate") or "")[:10] or None
            match = choose_match(title, publish_date or "", by_title, fuzzy_threshold)
            if match.status == "matched":
                counts["matched_episodes"] += 1
            episodes_payload.append(
                (
                    podtrac_id,
                    title,
                    publish_date,
                    run_id,
                    imported_at,
                    match.track_id,
                    match.title,
                    match.publish_date,
                    match.status,
                    match.method,
                    match.score,
                    match.notes,
                    normalize_title(title),
                )
            )
        episode_sql = """
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
        for batch in chunks(episodes_payload, batch_size):
            cur.executemany(episode_sql, batch)
        counts["episodes"] = len(episodes_payload)
        counts["unmatched_episodes"] = counts["episodes"] - counts["matched_episodes"]

        for table, report, id_col, count_key in (
            ("podtrac_countries", "country", "podtrac_country_id", "countries"),
            ("podtrac_clients", "client", "podtrac_client_id", "clients"),
        ):
            rows = [
                (str(row["rowID"]), row.get("title") or str(row["rowID"]), run_id, imported_at)
                for row in payloads[report].row_totals
            ]
            sql = f"""
                insert into {table}({id_col}, name, import_run_id, imported_at, updated_at)
                values (%s, %s, %s, %s, now())
                on conflict({id_col}) do update set
                    name=excluded.name,
                    import_run_id=excluded.import_run_id,
                    imported_at=excluded.imported_at,
                    updated_at=now()
            """
            for batch in chunks(rows, batch_size):
                cur.executemany(sql, batch)
            counts[count_key] = len(rows)

        activity_specs = (
            ("episode", "podtrac_daily_activity", "podtrac_episode_id", "daily_activity"),
            ("country", "podtrac_activity_by_country", "podtrac_country_id", "country_activity"),
            ("client", "podtrac_activity_by_client", "podtrac_client_id", "client_activity"),
        )
        for report, table, id_col, count_key in activity_specs:
            rows = []
            for row_id, date_counts in payloads[report].cells.items():
                for activity_date, count in date_counts.items():
                    rows.append((activity_date, row_id, int(count or 0), run_id, imported_at))
            sql = f"""
                insert into {table}(activity_date, {id_col}, download_count, import_run_id, imported_at, updated_at)
                values (%s, %s, %s, %s, %s, now())
                on conflict(activity_date, {id_col}) do update set
                    download_count=excluded.download_count,
                    import_run_id=excluded.import_run_id,
                    imported_at=excluded.imported_at,
                    updated_at=now()
            """
            for batch in chunks(rows, batch_size):
                cur.executemany(sql, batch)
            counts[count_key] = len(rows)

        cur.execute(
            """
            update podtrac_sync_runs set completed_at=now(), status='completed',
                import_run_id=%s,
                import_runs_count=1,
                metadata_count=0,
                episodes_count=%s,
                countries_count=%s,
                clients_count=%s,
                daily_activity_count=%s,
                country_activity_count=%s,
                client_activity_count=%s,
                matched_episodes_count=%s,
                unmatched_episodes_count=%s
            where id=%s and status='running'
            """,
            (
                run_id,
                counts["episodes"],
                counts["countries"],
                counts["clients"],
                counts["daily_activity"],
                counts["country_activity"],
                counts["client_activity"],
                counts["matched_episodes"],
                counts["unmatched_episodes"],
                sync_id,
            ),
        )
        if cur.rowcount != 1:
            raise RuntimeError("Podtrac sync attempt is no longer running.")
    counts["run_id"] = run_id
    counts["sync_id"] = int(sync_id)
    return counts


def write_log(log_dir: Path, run_id: int, payload: dict) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    path = log_dir / f"podtrac_daily_{run_id}.json"
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, default=str))
    return path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch daily Podtrac stats and upsert directly to Postgres.")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--curl-file", type=Path, default=DEFAULT_CURL_FILE)
    parser.add_argument("--log-dir", type=Path, default=DEFAULT_LOG_DIR)
    parser.add_argument("--auth-mode", choices=("chrome", "curl"), default="chrome")
    parser.add_argument("--start", help="Override start date, YYYY-MM-DD.")
    parser.add_argument("--end", help="Override end date, YYYY-MM-DD. Defaults to today minus available lag.")
    parser.add_argument("--available-lag-days", type=int, default=1)
    parser.add_argument("--lookback-days", type=int, default=7, help="Refetch this many days before latest DB date.")
    parser.add_argument("--max-window-days", type=int, default=45, help="Cap API fetch windows to avoid column paging.")
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument("--sleep", type=float, default=0.25)
    parser.add_argument("--fuzzy-threshold", type=float, default=0.91)
    parser.add_argument("--db-connect-retries", type=int, default=6)
    parser.add_argument("--db-connect-timeout", type=int, default=10)
    parser.add_argument("--db-connect-sleep", type=float, default=15.0)
    parser.add_argument("--dry-run", action="store_true", help="Fetch reports and print counts without writing Postgres.")
    parser.add_argument(
        "--server-admin-mode",
        action="store_true",
        help="Require the fixed farm AIC runner, interpreter, canonical env, curl auth, and log paths.",
    )
    return parser.parse_args()


def validate_server_admin_runtime(args: argparse.Namespace) -> None:
    if not args.server_admin_mode:
        return
    required_paths = {
        "runner": (Path(__file__).absolute(), SERVER_RUNNER),
        "interpreter": (Path(sys.executable).absolute(), SERVER_PYTHON),
        "canonical environment": (args.env_file, SERVER_ENV_FILE),
        "curl authentication": (args.curl_file, SERVER_CURL_FILE),
        "log directory": (args.log_dir, SERVER_LOG_DIR),
    }
    for label, (actual, required) in required_paths.items():
        if actual != required:
            raise RuntimeError(f"Server admin Podtrac {label} must be {required}; got {actual}.")
    if args.auth_mode != "curl":
        raise RuntimeError("Server admin Podtrac ingest requires --auth-mode curl.")


def run(args: argparse.Namespace) -> int:
    load_env(args.env_file)
    started_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with connect_pg(args) as pg:
        start, end = choose_window(pg, args)

    source = sync_attempt_source(start, end)
    sync_id = None if args.dry_run else create_sync_attempt(args, source)
    try:
        headers = parse_headers_from_curl(args.curl_file) if args.auth_mode == "curl" else {}
        payloads = {report: fetch_report(report, start, end, headers, args.sleep, args.auth_mode) for report in REPORTS}
    except Exception as error:
        if sync_id is not None:
            fail_sync_attempt(args, sync_id, error, "fetch")
        raise

    result = {
        "started_at": started_at,
        "date_window": {"start": start.isoformat(), "end": end.isoformat()},
        "reports": {
            report: {
                "total_rows": payload.matrix.get("totalRows"),
                "row_windows": payload.matrix.get("rowWindowCount"),
                "row_totals": len(payload.row_totals),
                "cell_rows": len(payload.cells),
                "cell_count": sum(len(value) for value in payload.cells.values()),
            }
            for report, payload in payloads.items()
        },
        "dry_run": bool(args.dry_run),
    }
    if args.dry_run:
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0

    assert sync_id is not None
    try:
        with connect_pg(args) as pg:
            try:
                counts = upsert_podtrac(
                    pg,
                    sync_id,
                    payloads,
                    start,
                    end,
                    source,
                    args.fuzzy_threshold,
                    args.batch_size,
                )
                pg.commit()
            except Exception:
                pg.rollback()
                raise
    except Exception as error:
        fail_sync_attempt(args, sync_id, error, "database")
        raise

    result["counts"] = counts
    result["completed_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    log_path = write_log(args.log_dir, int(counts["run_id"]), result)
    print(json.dumps(result, indent=2, sort_keys=True))
    print(f"Wrote {log_path}", flush=True)
    return 0


def main() -> int:
    args = parse_args()
    validate_server_admin_runtime(args)
    return run(args)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
