#!/usr/bin/env python3
"""Bridge Strapi episode publication outbox rows into the AIC podcast pipeline.

Publication itself only writes the Strapi transaction. This worker is the
retryable cross-database boundary: it claims one durable request, upserts the
operational episode row without replacing useful values with blanks, stages
managed audio, and invokes the existing idempotent per-track ingest runner.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import datetime as dt
import fcntl
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
from typing import Any
import urllib.error
import urllib.parse
import urllib.request

import psycopg
from psycopg.rows import dict_row

try:
    from scripts.aic_database_env import database_dsn, load_canonical_aic_env
except ModuleNotFoundError:  # Direct execution from /mnt/storage/aic/scripts.
    from aic_database_env import database_dsn, load_canonical_aic_env


DEFAULT_ENV_FILE = Path("/mnt/storage/aic/.env")
DEFAULT_PODCAST_ENV_FILE = Path("/mnt/storage/aic_podcast/.env")
DEFAULT_PODCAST_ROOT = Path("/mnt/storage/aic_podcast")
DEFAULT_AUDIO_DIR = Path("/mnt/storage/podcasts")
DEFAULT_STRAPI_MEDIA_ROOT = Path("/mnt/storage/pastorwood-media/strapi/uploads")
DEFAULT_PUBLIC_MEDIA_ROOT = Path("/mnt/storage/pastorwood-media/public")
DEFAULT_MC_BIN = Path("/usr/local/bin/mc")
DEFAULT_LOCK_FILE = Path("/tmp/aic_episode_publish_worker.lock")
TRACK_ID_PATTERN = re.compile(
    r"^(?:[0-9]+|sa_[0-9]+|wp-sermon:[0-9]+|cms_[a-z0-9][a-z0-9_-]{0,62})$"
)
SOURCE_FINGERPRINT_PATTERN = re.compile(r"^[0-9a-f]{64}$")
MAX_AUDIO_BYTES = 250 * 1024 * 1024
DEFAULT_MAX_ATTEMPTS = 6
DEFAULT_STALE_SECONDS = 4 * 60 * 60
DEFAULT_RUN_TIMEOUT_SECONDS = 3 * 60 * 60


@dataclass(frozen=True)
class StagedAudio:
    path: Path
    source: str
    fingerprint: str


class RequestNoLongerCurrent(RuntimeError):
    """Stop stale work without requeueing it ahead of a newer publication."""


class StrapiRequestError(RuntimeError):
    """Expose an HTTP status without leaking the managed API token."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def iso(value: dt.datetime | None = None) -> str:
    return (value or utc_now()).isoformat(timespec="seconds")


def load_env(path: Path) -> None:
    load_canonical_aic_env(path)


def load_supplemental_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def dsn() -> str:
    return database_dsn(application_name="aic-episode-publish-worker")


def bounded_text(value: Any, limit: int) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def validate_track_id(value: Any) -> str:
    track_id = value.strip() if isinstance(value, str) else ""
    if len(track_id) > 100 or not TRACK_ID_PATTERN.fullmatch(track_id):
        raise ValueError(
            "Track ID must be at most 100 characters and use a numeric, sa_<number>, "
            "wp-sermon:<number>, or safe cms_<name> value."
        )
    return track_id


def clean_detail(payload: dict[str, Any]) -> str:
    summary = bounded_text(payload.get("summary"), 20_000)
    if summary:
        return summary
    description = bounded_text(payload.get("description"), 100_000)
    without_markup = re.sub(r"<[^>]+>", " ", description)
    return re.sub(r"\s+", " ", html.unescape(without_markup)).strip()[:20_000]


def publish_date(payload: dict[str, Any]) -> str:
    value = bounded_text(payload.get("programDate"), 40) or bounded_text(payload.get("publishDate"), 80)
    return value[:10] if value else ""


def sanitized_error(error: Exception) -> str:
    message = f"{type(error).__name__}: {error}"
    message = re.sub(
        r"(?i)\bauthorization\s*([=:])\s*(?:bearer\s+)?([^\s,;]+)",
        r"Authorization\1[redacted]",
        message,
    )
    message = re.sub(
        r"(?i)\b(password|token|api[_-]?key)\s*([=:])\s*([^\s,;]+)",
        r"\1\2[redacted]",
        message,
    )
    message = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", " ", message)
    return message[-4_000:]


def connect_operational_database() -> psycopg.Connection[Any]:
    # Autocommit keeps read-only coverage checks from holding a transaction
    # open while the external ingest runner uses its own database connection.
    # Mutating helpers still establish explicit, short transactions.
    return psycopg.connect(dsn(), autocommit=True, row_factory=dict_row)


def processing_decision(
    request: dict[str, Any],
    coverage: dict[str, Any],
    provenance: dict[str, Any] | None,
    audio_fingerprint: str,
    audio_source: str,
) -> tuple[str, bool]:
    if bool(request.get("forceReprocess")):
        return "explicit_reprocess", True
    if provenance and bounded_text(provenance.get("audio_fingerprint"), 200) != audio_fingerprint:
        return "audio_changed", True
    if not provenance and not audio_source.startswith("minio:"):
        return "untracked_managed_audio", True
    if not bool(coverage.get("complete")):
        return "incomplete_coverage", False
    if not provenance:
        return "adopt_existing_coverage", False
    return "matching_complete_provenance", False


class StrapiClient:
    def __init__(self, base_url: str, token: str, timeout_seconds: int = 30):
        parsed = urllib.parse.urlsplit(base_url.rstrip("/"))
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
            raise ValueError("Episode processing requires the private loopback Strapi URL.")
        if not token:
            raise ValueError("STRAPI_API_TOKEN is required for episode processing.")
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout_seconds = timeout_seconds

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            urllib.parse.urljoin(self.base_url + "/", path.lstrip("/")),
            data=body,
            method=method,
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {self.token}",
                **({"Content-Type": "application/json"} if body is not None else {}),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            detail = error.read(1_000).decode("utf-8", errors="replace")
            raise StrapiRequestError(
                error.code,
                f"Strapi {method} failed ({error.code}): {detail}",
            ) from error

    def list_requests(
        self,
        status: str,
        *,
        before_field: str | None = None,
        before_value: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        query: list[tuple[str, str]] = [
            ("filters[status][$eq]", status),
            ("sort", "createdAt:asc"),
            ("pagination[pageSize]", str(max(1, min(limit, 100)))),
        ]
        if before_field and before_value:
            query.append((f"filters[{before_field}][$lte]", before_value))
        response = self.request(
            "GET",
            f"/api/episode-processing-requests?{urllib.parse.urlencode(query)}",
        ) or {}
        rows = response.get("data") if isinstance(response, dict) else []
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def update_request(self, document_id: str, data: dict[str, Any]) -> dict[str, Any]:
        response = self.request(
            "PUT",
            f"/api/episode-processing-requests/{urllib.parse.quote(document_id, safe='')}",
            {"data": data},
        ) or {}
        row = response.get("data") if isinstance(response, dict) else None
        if not isinstance(row, dict):
            raise RuntimeError("Strapi did not return the updated episode processing request.")
        return row

    def get_request(self, document_id: str) -> dict[str, Any]:
        response = self.request(
            "GET",
            f"/api/episode-processing-requests/{urllib.parse.quote(document_id, safe='')}",
        ) or {}
        row = response.get("data") if isinstance(response, dict) else None
        if not isinstance(row, dict):
            raise RuntimeError("Strapi did not return the episode processing request.")
        return row

    def latest_request(self, episode_document_id: str) -> dict[str, Any] | None:
        query = [
            ("filters[episodeDocumentId][$eq]", episode_document_id),
            ("sort", "revisionNumber:desc"),
            ("pagination[pageSize]", "1"),
        ]
        response = self.request(
            "GET",
            f"/api/episode-processing-requests?{urllib.parse.urlencode(query)}",
        ) or {}
        rows = response.get("data") if isinstance(response, dict) else None
        if not isinstance(rows, list):
            raise RuntimeError("Strapi did not return the episode processing request list.")
        return rows[0] if rows and isinstance(rows[0], dict) else None

    def transition_request(
        self,
        request: dict[str, Any],
        data: dict[str, Any],
    ) -> dict[str, Any] | None:
        document_id = request_document_id(request)
        payload = {
            "data": {
                "requestKey": request_key(request),
                "episodeDocumentId": episode_document_id(request),
                "workerId": bounded_text(request.get("workerId"), 300),
                **data,
            }
        }
        try:
            response = self.request(
                "POST",
                (
                    "/api/episode-processing-requests/"
                    f"{urllib.parse.quote(document_id, safe='')}/worker-transition"
                ),
                payload,
            ) or {}
        except StrapiRequestError as error:
            if error.status_code == 409:
                return None
            raise
        row = response.get("data") if isinstance(response, dict) else None
        if not isinstance(row, dict):
            raise RuntimeError("Strapi did not return the transitioned episode processing request.")
        return row


def request_document_id(request: dict[str, Any]) -> str:
    document_id = bounded_text(request.get("documentId"), 200)
    if not document_id:
        raise ValueError("Episode processing request is missing documentId.")
    return document_id


def episode_document_id(request: dict[str, Any]) -> str:
    document_id = bounded_text(request.get("episodeDocumentId"), 200)
    if not document_id:
        raise ValueError("Episode processing request is missing episodeDocumentId.")
    return document_id


def request_key(request: dict[str, Any]) -> str:
    key = bounded_text(request.get("requestKey"), 500)
    if not key:
        raise ValueError("Episode processing request is missing requestKey.")
    return key


def supersede_stale_request(client: StrapiClient, request: dict[str, Any], latest_revision: int) -> None:
    current = client.get_request(request_document_id(request))
    if current.get("status") == "superseded":
        return
    client.update_request(
        request_document_id(request),
        {
            "status": "superseded",
            "claimedAt": None,
            "workerId": "",
            "completedAt": iso(),
            "lastError": f"Superseded by publication revision {latest_revision}.",
        },
    )


def ensure_request_current(client: StrapiClient, request: dict[str, Any]) -> dict[str, Any]:
    current = client.get_request(request_document_id(request))
    latest = client.latest_request(episode_document_id(request))
    current_key = request_key(request)
    latest_key = request_key(latest) if latest else ""
    latest_revision = int(latest.get("revisionNumber") or 0) if latest else 0
    if current.get("status") == "superseded" or latest_key != current_key:
        supersede_stale_request(client, request, latest_revision)
        raise RequestNoLongerCurrent(
            f"Episode publication request was superseded by revision {latest_revision}."
        )
    expected_worker = bounded_text(request.get("workerId"), 300)
    if current.get("status") != "running" or bounded_text(current.get("workerId"), 300) != expected_worker:
        raise RequestNoLongerCurrent("Episode publication request claim is no longer owned by this worker.")
    return current


def recover_stale_requests(
    client: StrapiClient,
    *,
    now: dt.datetime,
    stale_seconds: int,
    max_attempts: int,
) -> list[str]:
    cutoff = iso(now - dt.timedelta(seconds=stale_seconds))
    recovered: list[str] = []
    for request in client.list_requests("running", before_field="claimedAt", before_value=cutoff):
        document_id = request_document_id(request)
        attempts = max(0, int(request.get("attemptCount") or 0))
        terminal = attempts >= max_attempts
        client.update_request(
            document_id,
            {
                "status": "failed" if terminal else "queued",
                "nextAttemptAt": iso(now),
                "claimedAt": None,
                "workerId": "",
                "completedAt": iso(now) if terminal else None,
                "lastError": (
                    f"Worker stopped before completion; stale claim recovered after attempt {attempts}."
                ),
            },
        )
        recovered.append(document_id)
    return recovered


def claim_request(
    client: StrapiClient,
    *,
    now: dt.datetime,
    worker_id: str,
    max_attempts: int,
) -> dict[str, Any] | None:
    for _ in range(100):
        rows = client.list_requests("queued", before_field="nextAttemptAt", before_value=iso(now), limit=1)
        if not rows:
            return None
        request = rows[0]
        document_id = request_document_id(request)
        attempts = max(0, int(request.get("attemptCount") or 0))
        if attempts >= max_attempts:
            client.update_request(
                document_id,
                {
                    "status": "failed",
                    "claimedAt": None,
                    "workerId": "",
                    "completedAt": iso(now),
                    "lastError": f"Terminal failure after {attempts} processing attempts.",
                },
            )
            continue
        return client.update_request(
            document_id,
            {
                "status": "running",
                "attemptCount": attempts + 1,
                "claimedAt": iso(now),
                "workerId": worker_id,
                "completedAt": None,
            },
        )
    raise RuntimeError("Too many terminal episode processing requests blocked the due queue.")


def retry_delay_seconds(attempt_count: int) -> int:
    return min(60 * 60, 60 * (2 ** max(0, attempt_count - 1)))


def mark_failed(
    client: StrapiClient,
    request: dict[str, Any],
    error: Exception,
    *,
    now: dt.datetime,
    max_attempts: int,
) -> bool:
    attempts = max(1, int(request.get("attemptCount") or 1))
    terminal = attempts >= max_attempts
    message = sanitized_error(error)
    updated = client.transition_request(
        request,
        {
            "status": "failed" if terminal else "queued",
            "nextAttemptAt": iso(now + dt.timedelta(seconds=retry_delay_seconds(attempts))),
            "lastError": message,
            **({"completedAt": iso(now)} if terminal else {}),
        },
    )
    return updated is not None


def mark_completed(client: StrapiClient, request: dict[str, Any], result: dict[str, Any], *, now: dt.datetime) -> None:
    updated = client.transition_request(
        request,
        {
            "status": "completed",
            "result": result,
            "completedAt": iso(now),
        },
    )
    if updated is None:
        raise RequestNoLongerCurrent(
            "Episode publication request was superseded before its completion could be recorded."
        )


def upsert_operational_episode(
    conn: psycopg.Connection[Any],
    request: dict[str, Any],
    payload: dict[str, Any],
) -> str:
    track_id = validate_track_id(payload.get("trackId"))
    document_id = episode_document_id(request)
    source_fingerprint = payload.get("sourceFingerprint", "")
    if not isinstance(source_fingerprint, str):
        raise ValueError("Episode source fingerprint is malformed.")
    source_fingerprint = source_fingerprint.strip()
    if source_fingerprint and not SOURCE_FINGERPRINT_PATTERN.fullmatch(source_fingerprint):
        raise ValueError("Episode source fingerprint is malformed.")
    title = bounded_text(payload.get("title"), 1_000)
    if not title:
        raise ValueError("Published episode is missing a title.")
    values = (
        track_id,
        title,
        publish_date(payload),
        "Abiding in Christ w/ Jim Wood",
        "Radio",
        clean_detail(payload),
        f"{track_id}.mp3",
    )
    with conn.transaction():
        existing_episode = conn.execute(
            "select track_id from episodes where track_id = %s for update",
            (track_id,),
        ).fetchone()
        owners = conn.execute(
            """
            select track_id, episode_document_id, source_fingerprint
            from episode_processing_ownership
            where track_id = %s or episode_document_id = %s
            for update
            """,
            (track_id, document_id),
        ).fetchall()
        matching_owner = any(
            str(owner.get("track_id") or "") == track_id
            and str(owner.get("episode_document_id") or "") == document_id
            for owner in owners
        )
        if owners and not matching_owner:
            raise ValueError("Track ID is permanently owned by a different Strapi episode.")
        if not matching_owner:
            if existing_episode and not source_fingerprint:
                raise ValueError(
                    "Track ID already exists in the operational archive and requires explicit baseline reconciliation."
                )
            conn.execute(
                """
                insert into episode_processing_ownership(
                    track_id, episode_document_id, source_fingerprint, claimed_at, updated_at
                ) values (%s, %s, %s, now(), now())
                """,
                (track_id, document_id, source_fingerprint),
            )
        row = conn.execute(
            """
            insert into episodes(track_id, title, publish_date, album, category, detail, source_file, updated_at)
            values (%s, %s, %s, %s, %s, %s, %s, now())
            on conflict(track_id) do update set
                title = coalesce(nullif(excluded.title, ''), episodes.title),
                publish_date = coalesce(nullif(excluded.publish_date, ''), episodes.publish_date),
                album = coalesce(nullif(episodes.album, ''), excluded.album),
                category = coalesce(nullif(episodes.category, ''), excluded.category),
                detail = coalesce(nullif(excluded.detail, ''), episodes.detail),
                source_file = coalesce(nullif(episodes.source_file, ''), excluded.source_file),
                updated_at = now()
            returning track_id
            """,
            values,
        ).fetchone()
    if not row:
        raise RuntimeError("Operational episode upsert returned no row.")
    return track_id


def operational_coverage(conn: psycopg.Connection[Any], track_id: str) -> dict[str, Any]:
    row = conn.execute(
        """
        select
          (select count(*)::int from transcript_segments where track_id = %s) as transcript_segments,
          (select count(*)::int from transcript_chunks where track_id = %s) as transcript_chunks,
          (select count(*)::int from transcript_chunks where track_id = %s and embedding is not null) as speech_vectors,
          coalesce((select status from episode_intelligence where track_id = %s), '') as intelligence_status,
          (select count(*)::int from episode_intelligence_vectors where track_id = %s and embedding is not null) as intelligence_vectors
        """,
        (track_id, track_id, track_id, track_id, track_id),
    ).fetchone()
    coverage = dict(row or {})
    coverage["complete"] = bool(
        (int(coverage.get("transcript_segments") or 0) > 0 or int(coverage.get("transcript_chunks") or 0) > 0)
        and int(coverage.get("speech_vectors") or 0) > 0
        and coverage.get("intelligence_status") == "completed"
        and int(coverage.get("intelligence_vectors") or 0) > 0
    )
    return coverage


def operational_provenance(
    conn: psycopg.Connection[Any],
    track_id: str,
) -> dict[str, Any] | None:
    row = conn.execute(
        """
        select track_id, episode_document_id, revision_number, request_key,
               audio_source, audio_fingerprint, completed_at
        from episode_processing_provenance
        where track_id = %s
        """,
        (track_id,),
    ).fetchone()
    return dict(row) if row else None


def ensure_operational_ownership(
    conn: psycopg.Connection[Any],
    request: dict[str, Any],
    track_id: str,
) -> None:
    owner = conn.execute(
        """
        select track_id
        from episode_processing_ownership
        where track_id = %s and episode_document_id = %s
        """,
        (track_id, episode_document_id(request)),
    ).fetchone()
    if not owner:
        raise ValueError("Track ID ownership no longer matches this Strapi episode.")


def reset_derived_processing(conn: psycopg.Connection[Any], track_id: str) -> dict[str, int]:
    deleted: dict[str, int] = {}
    tables = (
        "episode_intelligence_vectors",
        "episode_intelligence_items",
        "episode_intelligence",
        "transcript_references",
        "transcript_segments",
        "transcript_chunks",
    )
    with conn.transaction():
        for table in tables:
            cursor = conn.execute(f"delete from {table} where track_id = %s", (track_id,))
            deleted[table] = max(0, int(cursor.rowcount or 0))
    return deleted


def save_processing_provenance(
    conn: psycopg.Connection[Any],
    request: dict[str, Any],
    track_id: str,
    staged_audio: StagedAudio,
    *,
    now: dt.datetime,
) -> None:
    episode_document_id = bounded_text(request.get("episodeDocumentId"), 200)
    request_key = bounded_text(request.get("requestKey"), 500)
    revision_number = int(request.get("revisionNumber") or 0)
    if not episode_document_id or not request_key or revision_number < 1:
        raise ValueError("Episode processing request provenance is incomplete.")
    with conn.transaction():
        ensure_operational_ownership(conn, request, track_id)
        conn.execute(
            """
            insert into episode_processing_provenance(
                track_id, episode_document_id, revision_number, request_key,
                audio_source, audio_fingerprint, completed_at, updated_at
            ) values (%s, %s, %s, %s, %s, %s, %s, now())
            on conflict(track_id) do update set
                revision_number = excluded.revision_number,
                request_key = excluded.request_key,
                audio_source = excluded.audio_source,
                audio_fingerprint = excluded.audio_fingerprint,
                completed_at = excluded.completed_at,
                updated_at = now()
            where episode_processing_provenance.episode_document_id = excluded.episode_document_id
            """,
            (
                track_id,
                episode_document_id,
                revision_number,
                request_key,
                staged_audio.source,
                staged_audio.fingerprint,
                now,
            ),
        )


def safe_managed_file(root: Path, relative: str) -> Path:
    root = root.resolve()
    candidate = (root / relative.lstrip("/")).resolve()
    if candidate == root or root not in candidate.parents:
        raise ValueError("Managed audio path escapes its configured storage root.")
    if not candidate.is_file():
        raise FileNotFoundError(f"Managed audio file does not exist: {relative}")
    size = candidate.stat().st_size
    if size <= 0 or size > MAX_AUDIO_BYTES:
        raise ValueError("Managed audio must be a non-empty MP3 no larger than 250 MB.")
    if candidate.suffix.lower() != ".mp3":
        raise ValueError("Automatic episode processing currently requires MP3 audio.")
    return candidate


def payload_audio_url(payload: dict[str, Any]) -> str:
    audio = payload.get("audio")
    if isinstance(audio, dict):
        url = bounded_text(audio.get("url"), 2_000)
        if url:
            return url
    return bounded_text(payload.get("externalAudioUrl"), 2_000)


def minio_target(track_id: str) -> str:
    alias = os.environ.get("AIC_AUDIO_MC_ALIAS", "local-minio")
    bucket = os.environ.get("AIC_AUDIO_BUCKET", "aic")
    prefix = os.environ.get("AIC_AUDIO_PREFIX", "podcasts").strip("/")
    key = f"{prefix}/{track_id}.mp3" if prefix else f"{track_id}.mp3"
    return f"{alias}/{bucket}/{key}"


def fingerprint_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def staged_audio(path: Path, source: str) -> StagedAudio:
    return StagedAudio(path=path, source=source, fingerprint=fingerprint_file(path))


def require_minio_audio_size(target: str, mc_bin: Path) -> int:
    result = subprocess.run(
        [str(mc_bin), "stat", "--json", target],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout)[-1_000:].strip()
        raise FileNotFoundError(
            "No managed MP3 is available for this Track ID. Upload audio before retrying."
            + (f" ({detail})" if detail else "")
        )
    try:
        metadata = json.loads(result.stdout)
        size = int(metadata.get("size") or 0) if isinstance(metadata, dict) else 0
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        raise RuntimeError("Private object storage returned malformed audio metadata.") from error
    if size <= 0 or size > MAX_AUDIO_BYTES:
        raise ValueError("Managed audio must be a non-empty MP3 no larger than 250 MB.")
    return size


def stage_audio(
    payload: dict[str, Any],
    track_id: str,
    *,
    audio_dir: Path,
    strapi_media_root: Path,
    public_media_root: Path,
    mc_bin: Path,
) -> StagedAudio:
    audio_dir.mkdir(parents=True, exist_ok=True)
    destination = audio_dir / f"{track_id}.mp3"
    url = payload_audio_url(payload)
    parsed = urllib.parse.urlsplit(url)
    source: Path | None = None
    source_label = ""
    if not parsed.scheme and parsed.path.startswith("/uploads/"):
        source = safe_managed_file(strapi_media_root, parsed.path.removeprefix("/uploads/"))
        source_label = f"strapi:{parsed.path}"
    elif not parsed.scheme and parsed.path.startswith("/media/legacy/"):
        source = safe_managed_file(public_media_root, parsed.path.removeprefix("/media/legacy/"))
        source_label = f"legacy:{parsed.path}"
    elif not parsed.scheme and parsed.path.startswith("/media/episodes/"):
        requested_track_id = urllib.parse.unquote(parsed.path.removeprefix("/media/episodes/")).rstrip("/")
        if requested_track_id != track_id:
            raise ValueError("Managed episode audio path does not match the permanent Track ID.")
    elif parsed.scheme or (parsed.path and not parsed.path.startswith("/media/episodes/")):
        raise ValueError(
            "Automatic processing requires a Strapi MP3 upload or managed Pastor Wood audio path; remote URLs are not fetched."
        )

    if source:
        temporary = destination.with_suffix(".mp3.processing")
        shutil.copyfile(source, temporary)
        os.replace(temporary, destination)
        managed = safe_managed_file(audio_dir, destination.name)
        return staged_audio(managed, source_label)

    target = minio_target(track_id)
    require_minio_audio_size(target, mc_bin)
    temporary = destination.with_name(f".{destination.name}.processing.mp3")
    result = subprocess.run(
        [str(mc_bin), "cp", "--preserve", target, str(temporary)],
        capture_output=True,
        text=True,
        timeout=15 * 60,
        check=False,
    )
    if result.returncode != 0:
        temporary.unlink(missing_ok=True)
        detail = (result.stderr or result.stdout)[-1_000:].strip()
        raise RuntimeError(
            "Managed MP3 could not be staged from private object storage."
            + (f" ({detail})" if detail else "")
        )
    os.replace(temporary, destination)
    managed = safe_managed_file(audio_dir, destination.name)
    return staged_audio(managed, f"minio:{target}")


def publish_managed_audio(staged: StagedAudio, track_id: str, mc_bin: Path) -> None:
    if staged.source.startswith("minio:"):
        return
    result = subprocess.run(
        [str(mc_bin), "cp", "--preserve", str(staged.path), minio_target(track_id)],
        capture_output=True,
        text=True,
        timeout=15 * 60,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout)[-1_000:].strip()
        raise RuntimeError(
            "Managed episode audio could not be written to private object storage."
            + (f" ({detail})" if detail else "")
        )


def run_pipeline(
    request: dict[str, Any],
    track_id: str,
    *,
    podcast_root: Path,
    podcast_env_file: Path,
    timeout_seconds: int,
    retranscribe: bool,
) -> dict[str, Any]:
    python = podcast_root / ".venv-pg/bin/python"
    if not python.exists():
        python = Path(sys.executable)
    revision = int(request.get("revisionNumber") or 0)
    attempts = int(request.get("attemptCount") or 1)
    raw_id = request_document_id(request)
    safe_id = re.sub(r"[^A-Za-z0-9_-]+", "_", raw_id)[:60]
    run_id = f"cms_publish_{safe_id}_r{revision}_a{attempts}"
    command = [
        str(python),
        "-u",
        str(podcast_root / "run_daily_podcast_ingest.py"),
        "--env-file",
        str(podcast_env_file),
        "--skip-rss",
        "--track-id",
        track_id,
        "--max-tracks",
        "1",
        "--transcribe-engine",
        "mistral",
        "--transcribe-workers",
        "1",
        "--intelligence-workers",
        "1",
        "--intelligence-provider",
        "silo",
        "--intelligence-model",
        os.environ.get("AIC_INTELLIGENCE_MODEL", "openai-codex/gpt-5.6-luna"),
        "--intelligence-reasoning-effort",
        "medium",
        "--mistral-max-file-mb",
        str(MAX_AUDIO_BYTES // (1024 * 1024)),
        "--no-extractive-fallback",
        "--run-id",
        run_id,
    ]
    if retranscribe:
        command.append("--retranscribe")
    result = subprocess.run(
        command,
        cwd=podcast_root,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False,
    )
    if result.returncode != 0:
        output = "\n".join(part for part in (result.stdout, result.stderr) if part)[-4_000:].strip()
        raise RuntimeError(f"Per-track ingest exited with status {result.returncode}: {output}")
    return {
        "runId": run_id,
        "runner": "run_daily_podcast_ingest.py",
        "retranscribed": retranscribe,
    }


def process_request(
    client: StrapiClient,
    request: dict[str, Any],
    conn: psycopg.Connection[Any],
    args: argparse.Namespace,
) -> dict[str, Any]:
    payload = request.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("Episode processing request payload is missing or malformed.")
    ensure_request_current(client, request)
    track_id = upsert_operational_episode(conn, request, payload)
    ensure_request_current(client, request)
    staged = stage_audio(
        payload,
        track_id,
        audio_dir=args.audio_dir,
        strapi_media_root=args.strapi_media_root,
        public_media_root=args.public_media_root,
        mc_bin=args.mc_bin,
    )
    before = operational_coverage(conn, track_id)
    provenance = operational_provenance(conn, track_id)
    reason, retranscribe = processing_decision(
        request,
        before,
        provenance,
        staged.fingerprint,
        staged.source,
    )
    runner: dict[str, Any] = {"skipped": reason}
    reset: dict[str, int] = {}
    if reason not in {"matching_complete_provenance", "adopt_existing_coverage"}:
        ensure_request_current(client, request)
        publish_managed_audio(staged, track_id, args.mc_bin)
        if retranscribe:
            ensure_request_current(client, request)
            reset = reset_derived_processing(conn, track_id)
        ensure_request_current(client, request)
        runner = run_pipeline(
            request,
            track_id,
            podcast_root=args.podcast_root,
            podcast_env_file=args.podcast_env_file,
            timeout_seconds=args.run_timeout_seconds,
            retranscribe=retranscribe,
        )
        # Transcript import also upserts the episode row from transcript
        # metadata. Reassert the current non-blank CMS values afterward so an
        # older cached transcript cannot undo the publication metadata.
        ensure_request_current(client, request)
        upsert_operational_episode(conn, request, payload)
    after = operational_coverage(conn, track_id)
    if not after["complete"]:
        raise RuntimeError(f"Pipeline returned without complete operational coverage: {json.dumps(after, sort_keys=True)}")
    completed_at = utc_now()
    ensure_request_current(client, request)
    save_processing_provenance(conn, request, track_id, staged, now=completed_at)
    result = {
        "trackId": track_id,
        "processingReason": reason,
        "audioFingerprint": staged.fingerprint,
        "coverageBefore": before,
        "coverage": after,
        **({"reset": reset} if reset else {}),
        **runner,
    }
    mark_completed(client, request, result, now=completed_at)
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Process Strapi episode publication outbox rows.")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--podcast-env-file", type=Path, default=DEFAULT_PODCAST_ENV_FILE)
    parser.add_argument("--podcast-root", type=Path, default=DEFAULT_PODCAST_ROOT)
    parser.add_argument("--audio-dir", type=Path, default=DEFAULT_AUDIO_DIR)
    parser.add_argument("--strapi-media-root", type=Path, default=DEFAULT_STRAPI_MEDIA_ROOT)
    parser.add_argument("--public-media-root", type=Path, default=DEFAULT_PUBLIC_MEDIA_ROOT)
    parser.add_argument("--mc-bin", type=Path, default=DEFAULT_MC_BIN)
    parser.add_argument("--lock-file", type=Path, default=DEFAULT_LOCK_FILE)
    parser.add_argument("--limit", type=int, default=1)
    parser.add_argument("--max-attempts", type=int, default=DEFAULT_MAX_ATTEMPTS)
    parser.add_argument("--stale-seconds", type=int, default=DEFAULT_STALE_SECONDS)
    parser.add_argument("--run-timeout-seconds", type=int, default=DEFAULT_RUN_TIMEOUT_SECONDS)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_env(args.env_file)
    load_supplemental_env(args.podcast_env_file)
    base_url = os.environ.get("STRAPI_MANAGEMENT_URL") or os.environ.get("STRAPI_URL", "")
    token = os.environ.get("STRAPI_API_TOKEN", "")
    client = StrapiClient(base_url, token)
    args.lock_file.parent.mkdir(parents=True, exist_ok=True)
    lock_handle = args.lock_file.open("w")
    try:
        fcntl.flock(lock_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock_handle.close()
        print("another episode publication worker is active")
        return 0

    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    processed = 0
    failures = 0
    try:
        recovered = recover_stale_requests(
            client,
            now=utc_now(),
            stale_seconds=max(60, args.stale_seconds),
            max_attempts=max(1, args.max_attempts),
        )
        with connect_operational_database() as conn:
            while processed < max(1, args.limit):
                request = claim_request(
                    client,
                    now=utc_now(),
                    worker_id=worker_id,
                    max_attempts=max(1, args.max_attempts),
                )
                if not request:
                    break
                try:
                    process_request(client, request, conn, args)
                except RequestNoLongerCurrent as error:
                    print(
                        f"request={request_document_id(request)} stopped: {sanitized_error(error)}",
                        file=sys.stderr,
                    )
                except Exception as error:
                    marked_failed = mark_failed(
                        client,
                        request,
                        error,
                        now=utc_now(),
                        max_attempts=max(1, args.max_attempts),
                    )
                    if marked_failed:
                        failures += 1
                        print(
                            f"request={request_document_id(request)} failed: {sanitized_error(error)}",
                            file=sys.stderr,
                        )
                    else:
                        print(
                            f"request={request_document_id(request)} stopped after supersession.",
                            file=sys.stderr,
                        )
                processed += 1
        print(f"recovered={len(recovered)} processed={processed} failures={failures}")
        return 0 if failures == 0 else 1
    finally:
        fcntl.flock(lock_handle, fcntl.LOCK_UN)
        lock_handle.close()


if __name__ == "__main__":
    raise SystemExit(main())
