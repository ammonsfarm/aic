#!/usr/bin/env python3
"""Create missing Strapi episode drafts from the canonical episode catalog.

The default mode is a read-only plan. Applying a plan is deliberately
create-only: an episode found by Track ID is skipped and no update endpoint is
implemented by this client.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date, datetime, timezone
import hashlib
import html
import json
from pathlib import Path
import re
import sys
from typing import Any, Callable, Mapping, Sequence
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

import psycopg
from psycopg.rows import dict_row

try:
    from scripts.aic_database_env import CANONICAL_AIC_ENV, database_dsn, load_canonical_aic_env
except ModuleNotFoundError:  # Direct execution from /mnt/storage/aic/scripts.
    from aic_database_env import CANONICAL_AIC_ENV, database_dsn, load_canonical_aic_env


CANONICAL_STRAPI_URL = "http://127.0.0.1:1337"
CANONICAL_AUTHORITY = "aic-postgresql-and-minio-canonical-v1"
PUBLIC_ORIGIN = "https://www.pastorwood.org"
APPLY_CONFIRMATION = "CREATE_MISSING_CANONICAL_EPISODE_DRAFTS"
DEFAULT_LOOKBACK_DAYS = 14
MAX_LOOKBACK_DAYS = 31
DEFAULT_MAX_CREATES = 10
MAX_CREATES = 10
MAX_SCAN_ROWS = 100
MAX_RESPONSE_BYTES = 1_000_000
MAX_TITLE_LENGTH = 255
MAX_DESCRIPTION_LENGTH = 100_000
MAX_SLUG_LENGTH = 180
MAX_SEO_TITLE_LENGTH = 70
MAX_SEO_DESCRIPTION_LENGTH = 180
TRACK_ID_PATTERN = re.compile(
    r"(?:[0-9]+|sa_[0-9]+|wp-sermon:[0-9]+|cms_[a-z0-9][a-z0-9_-]{0,62})"
)
TAG_PATTERN = re.compile(r"<[^>]*>")
SYSTEM_ACTOR = {
    "id": "canonical-episode-draft-sync",
    "email": "canonical-episode-sync@pastorwood.local",
    "name": "Canonical episode draft sync",
}
REVISION_NOTE = (
    "Created automatically from the canonical PostgreSQL episode catalog after a successful "
    "scheduled daily ingest; retained as an unpublished draft for editorial review."
)


@dataclass(frozen=True)
class CanonicalEpisode:
    track_id: str
    title: str
    publish_date: str
    detail: str
    source_file: str
    updated_at: str


@dataclass(frozen=True)
class PlannedDraft:
    episode: CanonicalEpisode
    slug: str
    data: dict[str, Any]


def text(value: Any) -> str:
    return str(value or "").strip()


def validate_track_id(value: Any) -> str:
    track_id = text(value)
    if len(track_id) > 100 or not TRACK_ID_PATTERN.fullmatch(track_id):
        raise RuntimeError(f"Canonical episode has an unsafe Track ID: {track_id or '[empty]'}")
    return track_id


def slugify(value: str, fallback: str) -> str:
    normalized = unicodedata.normalize("NFKD", html.unescape(value)).encode("ascii", "ignore").decode("ascii")
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()
    return (normalized or fallback)[:MAX_SLUG_LENGTH]


def deterministic_slug_candidates(title: str, track_id: str) -> tuple[str, ...]:
    """Return stable candidates; hashed fallbacks cannot depend on inventory order."""

    safe_track_id = validate_track_id(track_id)
    base = slugify(title, f"episode-{safe_track_id}")
    digest = hashlib.sha256(safe_track_id.encode("utf-8")).hexdigest()
    candidates = (
        base,
        f"{base[: MAX_SLUG_LENGTH - 9]}-{digest[:8]}",
        f"{base[: MAX_SLUG_LENGTH - 17]}-{digest[:16]}",
        f"{base[: MAX_SLUG_LENGTH - 65]}-{digest}",
    )
    return tuple(dict.fromkeys(candidates))


def parse_publish_date(value: Any) -> tuple[str, str]:
    candidate = text(value)
    if len(candidate) < 10:
        raise RuntimeError("Canonical episode publish date is missing or invalid.")
    try:
        program_date = date.fromisoformat(candidate[:10])
    except ValueError as error:
        raise RuntimeError("Canonical episode publish date is missing or invalid.") from error

    if len(candidate) == 10:
        published = datetime.combine(program_date, datetime.min.time(), tzinfo=timezone.utc)
    else:
        normalized = candidate.replace(" ", "T", 1)
        if normalized.endswith("Z"):
            normalized = normalized[:-1] + "+00:00"
        elif not re.search(r"[+-]\d\d:\d\d$", normalized):
            normalized += "+00:00"
        try:
            published = datetime.fromisoformat(normalized)
        except ValueError as error:
            raise RuntimeError("Canonical episode publish date is missing or invalid.") from error
        if published.tzinfo is None:
            published = published.replace(tzinfo=timezone.utc)
    publish_date = published.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return program_date.isoformat(), publish_date


def plain_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(TAG_PATTERN.sub(" ", value))).strip()


def stable_fingerprint(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def safe_error(value: str, limit: int = 2_000) -> str:
    redacted = re.sub(
        r"(?i)(authorization|cookie|password|secret|api[_-]?key|token)\s*[:=]\s*[^\s,;]+",
        r"\1=[redacted]",
        value,
    )
    return redacted[-limit:].strip()


def canonical_episode_from_row(row: Mapping[str, Any]) -> CanonicalEpisode:
    track_id = validate_track_id(row.get("track_id"))
    title = text(row.get("title"))
    if not title or len(title) > MAX_TITLE_LENGTH:
        raise RuntimeError(f"Canonical episode {track_id} has an empty or overlong title.")
    detail = text(row.get("detail"))
    if len(detail) > MAX_DESCRIPTION_LENGTH:
        raise RuntimeError(f"Canonical episode {track_id} has an overlong description.")
    parse_publish_date(row.get("publish_date"))
    return CanonicalEpisode(
        track_id=track_id,
        title=title,
        publish_date=text(row.get("publish_date")),
        detail=detail,
        source_file=text(row.get("source_file")),
        updated_at=text(row.get("updated_at")),
    )


def build_episode_payload(episode: CanonicalEpisode, slug: str) -> dict[str, Any]:
    program_date, publish_date = parse_publish_date(episode.publish_date)
    summary = plain_text(episode.detail)[:600]
    canonical_url = f"{PUBLIC_ORIGIN}/radio/{slug}/"
    data: dict[str, Any] = {
        "trackId": episode.track_id,
        "legacyId": f"aic:{episode.track_id}",
        "wpSermonId": "",
        "title": episode.title,
        "slug": slug,
        "programDate": program_date,
        "summary": summary,
        "description": episode.detail,
        "externalAudioUrl": f"/media/episodes/{episode.track_id}",
        "publishDate": publish_date,
        "scheduledFor": None,
        "legacyUrl": "",
        "canonicalUrl": canonical_url,
        "seo": {
            "title": episode.title[:MAX_SEO_TITLE_LENGTH],
            "description": summary[:MAX_SEO_DESCRIPTION_LENGTH],
            "canonicalUrl": canonical_url,
            "noIndex": False,
        },
        "sourceFingerprint": "",
    }
    data["sourceFingerprint"] = stable_fingerprint(data)
    return data


def select_recent_canonical_episodes(
    conn: Any,
    *,
    lookback_days: int,
    scan_limit: int = MAX_SCAN_ROWS,
) -> list[CanonicalEpisode]:
    if not 1 <= lookback_days <= MAX_LOOKBACK_DAYS:
        raise ValueError(f"lookback_days must be between 1 and {MAX_LOOKBACK_DAYS}")
    if not 1 <= scan_limit <= MAX_SCAN_ROWS:
        raise ValueError(f"scan_limit must be between 1 and {MAX_SCAN_ROWS}")
    rows = conn.execute(
        """
        select track_id, title, publish_date, detail, source_file, updated_at
          from episodes
         where created_at >= now() - make_interval(days => %s)
            or (
                 left(publish_date, 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                 and left(publish_date, 10)::date >= current_date - %s
               )
         order by created_at, track_id
         limit %s
        """,
        (lookback_days, lookback_days, scan_limit + 1),
    ).fetchall()
    if len(rows) > scan_limit:
        raise RuntimeError(f"Canonical episode scan exceeded the safety bound of {scan_limit} rows.")
    return [canonical_episode_from_row(row) for row in rows]


class StrapiEpisodeDraftClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        urlopen: Callable[..., Any] = urllib.request.urlopen,
    ):
        if base_url.rstrip("/") != CANONICAL_STRAPI_URL or not token:
            raise RuntimeError("Episode draft sync requires canonical localhost Strapi and its management token.")
        self.base_url = CANONICAL_STRAPI_URL
        self._token = token
        self._urlopen = urlopen

    def request(self, path: str, method: str = "GET", payload: dict[str, Any] | None = None) -> Any:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            urllib.parse.urljoin(self.base_url + "/", path.lstrip("/")),
            data=body,
            method=method,
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {self._token}",
                **({"Content-Type": "application/json"} if body is not None else {}),
            },
        )
        try:
            with self._urlopen(request, timeout=30) as response:
                response_body = response.read(MAX_RESPONSE_BYTES + 1)
        except (OSError, TimeoutError, urllib.error.URLError, urllib.error.HTTPError) as error:
            status = getattr(error, "code", "unavailable")
            raise RuntimeError(f"Strapi {method} {path.split('?', 1)[0]} failed (HTTP {status}).") from error
        if len(response_body) > MAX_RESPONSE_BYTES:
            raise RuntimeError("Strapi response exceeded the fixed safety bound.")
        try:
            return json.loads(response_body) if response_body else None
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RuntimeError("Strapi returned an invalid JSON response.") from error

    @staticmethod
    def entity_data(value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            return {}
        attributes = value.get("attributes")
        if isinstance(attributes, dict):
            return {**attributes, **{key: item for key, item in value.items() if key != "attributes"}}
        return dict(value)

    def find_by_status(self, field: str, value: str, status: str) -> list[dict[str, Any]]:
        if field not in {"trackId", "legacyId", "slug"} or status not in {"draft", "published"}:
            raise ValueError("Unsupported Strapi episode lookup.")
        query = urllib.parse.urlencode(
            {
                f"filters[{field}][$eq]": value,
                "pagination[pageSize]": "2",
                "status": status,
            }
        )
        response = self.request(f"/api/episodes?{query}") or {}
        records = response.get("data") if isinstance(response, dict) else None
        if not isinstance(records, list) or len(records) > 1:
            raise RuntimeError(f"Strapi episode {field} lookup was invalid or non-unique.")
        return [self.entity_data(record) for record in records]

    def find_any(self, field: str, value: str) -> list[dict[str, Any]]:
        records: dict[str, dict[str, Any]] = {}
        for status in ("draft", "published"):
            for record in self.find_by_status(field, value, status):
                document_id = text(record.get("documentId"))
                if not document_id:
                    raise RuntimeError("Strapi episode lookup returned no document ID.")
                records[document_id] = record
        if len(records) > 1:
            raise RuntimeError(f"Strapi episode {field} identity is not unique.")
        return list(records.values())

    def create_episode(self, data: dict[str, Any]) -> dict[str, Any]:
        response = self.request(
            "/api/editorial/episode",
            "POST",
            {"actor": SYSTEM_ACTOR, "data": data, "note": REVISION_NOTE},
        )
        record = self.entity_data(response.get("data") if isinstance(response, dict) else None)
        if not text(record.get("documentId")):
            raise RuntimeError("Editorial episode creation returned no document ID.")
        return record


def canonical_strapi_client(env_values: Mapping[str, str]) -> StrapiEpisodeDraftClient:
    urls = {
        text(env_values.get(key)).rstrip("/")
        for key in ("STRAPI_MANAGEMENT_URL", "STRAPI_URL")
        if text(env_values.get(key))
    }
    tokens = {
        text(env_values.get(key))
        for key in ("STRAPI_API_TOKEN_TEMP_WRITE", "STRAPI_MANAGEMENT_TOKEN", "STRAPI_API_TOKEN")
        if text(env_values.get(key))
    }
    if urls != {CANONICAL_STRAPI_URL} or len(tokens) != 1:
        raise RuntimeError("Canonical AIC environment has ambiguous or non-canonical Strapi management settings.")
    return StrapiEpisodeDraftClient(next(iter(urls)), next(iter(tokens)))


def choose_slug(
    episode: CanonicalEpisode,
    client: Any,
    reserved_slugs: set[str],
) -> str:
    for candidate in deterministic_slug_candidates(episode.title, episode.track_id):
        if candidate in reserved_slugs:
            continue
        matches = client.find_any("slug", candidate)
        if not matches:
            reserved_slugs.add(candidate)
            return candidate
        if text(matches[0].get("trackId")) == episode.track_id:
            raise RuntimeError(f"Strapi episode {episode.track_id} appeared during slug planning.")
    raise RuntimeError(f"Could not derive a collision-free bounded slug for episode {episode.track_id}.")


def plan_episode_drafts(
    episodes: Sequence[CanonicalEpisode],
    client: Any,
    *,
    max_creates: int,
) -> tuple[list[PlannedDraft], list[dict[str, str]]]:
    if not 1 <= max_creates <= MAX_CREATES:
        raise ValueError(f"max_creates must be between 1 and {MAX_CREATES}")
    planned: list[PlannedDraft] = []
    existing: list[dict[str, str]] = []
    reserved_slugs: set[str] = set()
    for episode in episodes:
        matches = client.find_any("trackId", episode.track_id)
        if matches:
            existing.append(
                {
                    "trackId": episode.track_id,
                    "documentId": text(matches[0].get("documentId")),
                    "reason": "existing-strapi-episode-preserved",
                }
            )
            continue
        legacy_matches = client.find_any("legacyId", f"aic:{episode.track_id}")
        if legacy_matches:
            raise RuntimeError(
                f"Canonical legacy identity aic:{episode.track_id} belongs to another Strapi episode; refusing to create."
            )
        slug = choose_slug(episode, client, reserved_slugs)
        planned.append(PlannedDraft(episode, slug, build_episode_payload(episode, slug)))
    if len(planned) > max_creates:
        raise RuntimeError(
            f"Missing Strapi episode drafts ({len(planned)}) exceed the create safety bound ({max_creates})."
        )
    return planned, existing


def verify_created_draft(client: Any, item: PlannedDraft, created: Mapping[str, Any]) -> dict[str, str]:
    document_id = text(created.get("documentId"))
    if (
        not document_id
        or text(created.get("trackId")) != item.episode.track_id
        or text(created.get("slug")) != item.slug
        or created.get("publishedAt") not in {None, ""}
        or created.get("scheduledFor") not in {None, ""}
    ):
        raise RuntimeError(f"Created episode {item.episode.track_id} did not return verified draft state.")
    draft_matches = client.find_by_status("trackId", item.episode.track_id, "draft")
    published_matches = client.find_by_status("trackId", item.episode.track_id, "published")
    if (
        len(draft_matches) != 1
        or text(draft_matches[0].get("documentId")) != document_id
        or published_matches
    ):
        raise RuntimeError(f"Created episode {item.episode.track_id} was not verified as draft-only.")
    return {
        "trackId": item.episode.track_id,
        "documentId": document_id,
        "slug": item.slug,
        "publicationState": "draft",
        "auditActor": SYSTEM_ACTOR["email"],
        "revisionNote": REVISION_NOTE,
    }


def synchronize_episode_drafts(
    conn: Any,
    client: Any,
    *,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    max_creates: int = DEFAULT_MAX_CREATES,
    apply: bool = False,
    confirmation: str = "",
) -> dict[str, Any]:
    episodes = select_recent_canonical_episodes(conn, lookback_days=lookback_days)
    planned, existing = plan_episode_drafts(episodes, client, max_creates=max_creates)
    report: dict[str, Any] = {
        "authority": CANONICAL_AUTHORITY,
        "mode": "apply" if apply else "dry-run",
        "lookbackDays": lookback_days,
        "scanned": len(episodes),
        "existingPreserved": existing,
        "planned": [
            {
                "trackId": item.episode.track_id,
                "title": item.episode.title,
                "slug": item.slug,
                "programDate": item.data["programDate"],
                "publishDate": item.data["publishDate"],
                "sourceFingerprint": item.data["sourceFingerprint"],
            }
            for item in planned
        ],
        "created": [],
    }
    if not apply:
        return report
    if confirmation != APPLY_CONFIRMATION:
        raise RuntimeError(f"Applying requires the exact confirmation {APPLY_CONFIRMATION}.")

    # Recheck every identity before the first mutation. A concurrent editor or
    # prior run causes a closed failure, never an update or partial takeover.
    for item in planned:
        if client.find_any("trackId", item.episode.track_id):
            raise RuntimeError(f"Strapi episode {item.episode.track_id} appeared after planning; refusing to update it.")
        if client.find_any("legacyId", f"aic:{item.episode.track_id}"):
            raise RuntimeError(
                f"Canonical legacy identity aic:{item.episode.track_id} appeared after planning; refusing the create batch."
            )
        if client.find_any("slug", item.slug):
            raise RuntimeError(f"Strapi slug {item.slug} appeared after planning; refusing the create batch.")

    mutations = []
    for item in planned:
        created = client.create_episode(item.data)
        mutations.append(verify_created_draft(client, item, created))
    report["created"] = mutations
    return report


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create missing Strapi episode drafts from canonical PostgreSQL.")
    parser.add_argument("--env-file", type=Path, default=CANONICAL_AIC_ENV)
    parser.add_argument("--lookback-days", type=int, default=DEFAULT_LOOKBACK_DAYS)
    parser.add_argument("--max-creates", type=int, default=DEFAULT_MAX_CREATES)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm", default="")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.env_file != CANONICAL_AIC_ENV:
        raise RuntimeError(f"Production episode draft sync must use {CANONICAL_AIC_ENV}.")
    env_values = load_canonical_aic_env(args.env_file)
    client = canonical_strapi_client(env_values)
    with psycopg.connect(
        database_dsn(application_name="aic-canonical-episode-draft-sync"),
        row_factory=dict_row,
    ) as conn:
        conn.execute("set transaction read only")
        report = synchronize_episode_drafts(
            conn,
            client,
            lookback_days=args.lookback_days,
            max_creates=args.max_creates,
            apply=args.apply,
            confirmation=args.confirm,
        )
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAILED: {safe_error(str(error))}", file=sys.stderr)
        raise SystemExit(1)
