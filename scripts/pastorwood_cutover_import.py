#!/usr/bin/env python3
"""Plan or apply the PastorWood WordPress/AIC to Strapi public cutover.

The default mode is read-only.  Applying changes requires both ``--apply`` and
the literal confirmation value documented by ``--help``.  Database passwords
and Strapi tokens are read from environment files/environment variables and
are never placed in child-process arguments or written to reports.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import html
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Sequence


LEGACY_ORIGIN = "https://www.pastorwood.org"
DEFAULT_MIGRATION_ROOT = Path("/mnt/storage/pastorwood-migration-20260722")
DEFAULT_RESTRICTED_MEDIA_ROOT = Path("/mnt/storage/pastorwood-media/legacy/wp-content/uploads")
DEFAULT_PUBLIC_MEDIA_ROOT = Path("/mnt/storage/pastorwood-media/public")
PRIVATE_MEDIA_SEGMENTS = {
    "gravity_forms",
    "woocommerce_uploads",
    "woocommerce-logs",
    "wc-logs",
    "logs",
    "private",
    "tmp",
}
OPERATIONAL_PAGE_SLUGS = {
    "cart",
    "checkout",
    "donation-confirmation",
    "donation-failed",
    "donation-history",
    "my-account",
    "shop",
}
FIXED_PAGE_TARGETS = {
    "": "/",
    "home": "/",
    "about-pastor-wood": "/about-pastor-wood/",
    "abiding-in-christ": "/abiding-in-christ/",
    "board-members": "/board-members/",
    "endorsements": "/endorsements/",
    "weekly-devotional": "/bible-study/",
    "bible-study": "/bible-study/",
    "written-resources": "/written-resources/",
    "contact": "/contact/",
    "speaking-request": "/contact/",
    "donate": "/donate/",
    "donor-dashboard": "/donor-dashboard/",
    "privacy": "/privacy/",
    "privacy-terms-conditions": "/privacy-terms-conditions/",
    "radio": "/radio/",
}
FIXED_PAGE_KEYS = {
    "about-pastor-wood": "about",
    "abiding-in-christ": "abiding-in-christ",
    "board-members": "board-members",
    "endorsements": "endorsements",
    "weekly-devotional": "bible-study",
    "bible-study": "bible-study",
    "written-resources": "written-resources",
    "contact": "contact",
    "speaking-request": "contact",
    "donate": "donate",
    "donor-dashboard": "donor-dashboard",
    "privacy": "privacy",
    "privacy-terms-conditions": "privacy-terms-conditions",
    "radio": "radio",
}
RESERVED_REDIRECT_PREFIXES = (
    "/admin",
    "/api",
    "/archive",
    "/compose",
    "/content",
    "/login",
    "/overview",
    "/pipeline",
    "/preview",
    "/research",
    "/signals",
    "/sources",
    "/stats",
    "/_next",
)
APPLY_CONFIRMATION = "APPLY_PASTORWOOD_PUBLIC_CUTOVER"


WP_CONTENT_SQL = r"""
with selected_meta as (
  select post_id, coalesce(jsonb_object_agg(meta_key, meta_value), '{}'::jsonb) as meta
  from (
    select distinct on (post_id, meta_key) post_id, meta_key, meta_value
    from wp_postmeta
    where meta_key in (
      'sermon_audio', 'sermon_date', 'sermon_description', 'bible_passage',
      '_wpfc_sermon_duration', '_thumbnail_id', '_aioseo_title',
      '_aioseo_description', '_aioseo_og_title', '_aioseo_og_description',
      '_aioseo_twitter_title', '_aioseo_twitter_description', '_wp_old_slug'
    )
    order by post_id, meta_key, meta_id::bigint desc
  ) latest
  group by post_id
), categories as (
  select tr."object_id" as post_id, jsonb_agg(distinct t."slug") as slugs
  from wp_term_relationships tr
  join wp_term_taxonomy tt on tt."term_taxonomy_id" = tr."term_taxonomy_id"
  join wp_terms t on t."term_id" = tt."term_id"
  where tt."taxonomy" = 'category'
  group by tr."object_id"
)
select coalesce(jsonb_agg(jsonb_build_object(
  'id', p."ID", 'type', p.post_type, 'status', p.post_status,
  'title', p.post_title, 'slug', p.post_name, 'date', p.post_date,
  'dateGmt', p.post_date_gmt, 'modified', p.post_modified,
  'modifiedGmt', p.post_modified_gmt, 'content', p.post_content,
  'excerpt', p.post_excerpt, 'parentId', p.post_parent, 'guid', p.guid,
  'categories', coalesce(c.slugs, '[]'::jsonb),
  'meta', coalesce(m.meta, '{}'::jsonb)
) order by p."ID"::bigint), '[]'::jsonb)
from wp_posts p
left join selected_meta m on m.post_id = p."ID"
left join categories c on c.post_id = p."ID"
where p.post_status = 'publish'
  and p.post_type in ('page', 'post', 'wpfc_sermon');
"""

WP_ATTACHMENTS_SQL = r"""
with selected_meta as (
  select post_id, coalesce(jsonb_object_agg(meta_key, meta_value), '{}'::jsonb) as meta
  from (
    select distinct on (post_id, meta_key) post_id, meta_key, meta_value
    from wp_postmeta
    where meta_key in ('_wp_attached_file', '_wp_attachment_image_alt')
    order by post_id, meta_key, meta_id::bigint desc
  ) latest
  group by post_id
)
select coalesce(jsonb_agg(jsonb_build_object(
  'id', p."ID", 'title', p.post_title, 'slug', p.post_name,
  'date', p.post_date, 'modified', p.post_modified,
  'parentId', p.post_parent, 'guid', p.guid,
  'mimeType', p.post_mime_type, 'meta', coalesce(m.meta, '{}'::jsonb)
) order by p."ID"::bigint), '[]'::jsonb)
from wp_posts p
left join selected_meta m on m.post_id = p."ID"
where p.post_type = 'attachment';
"""

AIC_EPISODES_SQL = r"""
select coalesce(jsonb_agg(jsonb_build_object(
  'trackId', track_id, 'title', title, 'publishDate', publish_date,
  'album', album, 'category', category, 'detail', detail,
  'sourceFile', source_file, 'updatedAt', updated_at
) order by track_id), '[]'::jsonb)
from episodes;
"""

AIC_POSTS_SQL = r"""
select coalesce(jsonb_agg(jsonb_build_object(
  'postId', post_id, 'sourceType', source_type, 'title', title,
  'slug', slug, 'sourceUrl', source_url, 'publishDate', publish_date,
  'publishedAt', published_at, 'modifiedAt', modified_at,
  'excerptHtml', excerpt_html, 'contentHtml', content_html,
  'text', text, 'summary', summary, 'updatedAt', updated_at
) order by post_id), '[]'::jsonb)
from pastorwood_posts;
"""


@dataclass(frozen=True)
class EpisodeMatch:
    aic_track_id: str
    wp_sermon_id: str
    method: str


@dataclass(frozen=True)
class MediaRecord:
    attachment_id: str
    title: str
    relative_path: str
    source_url: str
    mime_type: str
    visibility: str
    referenced_by: tuple[str, ...]
    exists: bool
    size_bytes: int | None


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=Path(".env"), help="AIC/Strapi environment file")
    parser.add_argument("--pwood-container", default=os.environ.get("PWOOD_DB_CONTAINER", "farm-postgres"))
    parser.add_argument("--pwood-db-name", default=os.environ.get("PWOOD_DB_NAME", "pwood"))
    parser.add_argument("--pwood-db-user", default=os.environ.get("PWOOD_DB_USER", "farmfam"))
    parser.add_argument("--aic-postgres-image", default=os.environ.get("AIC_POSTGRES_CLIENT_IMAGE", "postgres:16"))
    parser.add_argument("--legacy-urls", type=Path, default=DEFAULT_MIGRATION_ROOT / "legacy-public-urls.txt")
    parser.add_argument("--attachment-manifest", type=Path, default=DEFAULT_MIGRATION_ROOT / "wordpress-attachment-urls.txt")
    parser.add_argument("--restricted-media-root", type=Path, default=DEFAULT_RESTRICTED_MEDIA_ROOT)
    parser.add_argument("--public-media-root", type=Path, default=DEFAULT_PUBLIC_MEDIA_ROOT)
    parser.add_argument("--plan-output", type=Path)
    parser.add_argument("--redirect-output", type=Path)
    parser.add_argument("--media-output", type=Path)
    parser.add_argument("--checkpoint", type=Path, default=Path(".migration-state/pastorwood-cutover-checkpoint.json"))
    parser.add_argument("--failure-report", type=Path, default=Path(".migration-state/pastorwood-cutover-failures.json"))
    parser.add_argument("--apply", action="store_true", help="Write to Strapi and the distinct public media root")
    parser.add_argument("--confirm", default="", help=f"Required with --apply: {APPLY_CONFIRMATION}")
    parser.add_argument("--verify-media", action="store_true", help="Stat every explicitly allowlisted source path")
    parser.add_argument("--verify-episode-audio", action="store_true", help="Read MinIO object names and reconcile all AIC track IDs")
    parser.add_argument("--mc-bin", default=os.environ.get("AIC_AUDIO_MC_BIN", "/usr/local/bin/mc"))
    parser.add_argument("--mc-audio-target", default=os.environ.get("AIC_AUDIO_MC_TARGET", "local-minio/aic/podcasts"))
    parser.add_argument("--copy-media", action="store_true", help="Copy/checksum public allowlisted media while applying")
    parser.add_argument("--no-resume", action="store_true", help="Ignore (but do not delete) a prior checkpoint")
    return parser.parse_args(argv)


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            values[key] = value
    return values


def run_json_command(command: list[str], sql: str, env: dict[str, str] | None = None) -> list[dict[str, Any]]:
    result = subprocess.run(
        command,
        input=sql,
        text=True,
        capture_output=True,
        check=False,
        env=env,
    )
    if result.returncode != 0:
        detail = re.sub(r"(?i)(password\s*[=:]\s*)\S+", r"\1[redacted]", result.stderr.strip())
        raise RuntimeError(detail or f"source query exited {result.returncode}")
    payload = result.stdout.strip()
    value = json.loads(payload or "[]")
    if not isinstance(value, list):
        raise RuntimeError("source query did not return a JSON array")
    return [item for item in value if isinstance(item, dict)]


def validate_identifier(value: str, label: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", value):
        raise ValueError(f"Unsafe {label} value")
    return value


def validate_image_reference(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./:@-]*", value):
        raise ValueError("Unsafe PostgreSQL client image value")
    return value


def fetch_wordpress(args: argparse.Namespace) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    container = validate_identifier(args.pwood_container, "container")
    database = validate_identifier(args.pwood_db_name, "database")
    user = validate_identifier(args.pwood_db_user, "database user")
    command = [
        "docker", "exec", "-i", container,
        "psql", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-U", user,
        "-d", database, "-Atq",
    ]
    return run_json_command(command, WP_CONTENT_SQL), run_json_command(command, WP_ATTACHMENTS_SQL)


def fetch_aic(env_values: dict[str, str], postgres_image: str = "postgres:16") -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    required = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"]
    missing = [key for key in required if not env_values.get(key)]
    if missing:
        raise RuntimeError(f"AIC source environment is missing: {', '.join(missing)}")
    child_env = os.environ.copy()
    child_env["PGPASSWORD"] = env_values["DB_PASSWORD"]
    image = validate_image_reference(postgres_image)
    command = [
        "docker", "run", "--rm", "-i", "--pull=never", "--network", "host",
        "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m", "-e", "PGPASSWORD", image,
        "psql", "--no-psqlrc", "--no-password", "-v", "ON_ERROR_STOP=1",
        "-h", env_values["DB_HOST"], "-p", env_values["DB_PORT"],
        "-U", env_values["DB_USER"], "-d", env_values["DB_NAME"], "-Atq",
    ]
    return (
        run_json_command(command, AIC_EPISODES_SQL, child_env),
        run_json_command(command, AIC_POSTS_SQL, child_env),
    )


def fetch_episode_audio_object_ids(mc_bin: str, target: str) -> set[str]:
    if not re.fullmatch(r"/[A-Za-z0-9._/-]+|[A-Za-z0-9._-]+/[A-Za-z0-9._/-]+", target):
        raise ValueError("Unsafe MinIO audio target")
    result = subprocess.run(
        [mc_bin, "find", target, "--name", "*.mp3", "--print", "{base}"],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "MinIO episode audio inventory failed")
    return {
        Path(line.strip()).stem
        for line in result.stdout.splitlines()
        if re.fullmatch(r"(?:\d+|sa_\d+)\.mp3", Path(line.strip()).name)
    }


def text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    return ""


def iso_date(value: Any) -> str:
    candidate = text(value)[:10]
    return candidate if re.fullmatch(r"\d{4}-\d{2}-\d{2}", candidate) else ""


def iso_datetime(value: Any) -> str | None:
    candidate = text(value).replace(" ", "T")
    if not candidate or candidate.startswith("0000-00-00"):
        return None
    if not re.search(r"(?:Z|[+-]\d\d:\d\d)$", candidate):
        candidate += "Z"
    return candidate


def wordpress_sermon_date(row: dict[str, Any]) -> str:
    meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
    raw_value = text(meta.get("sermon_date"))
    if raw_value.isdigit():
        try:
            return datetime.fromtimestamp(int(raw_value), timezone.utc).date().isoformat()
        except (OverflowError, OSError, ValueError):
            pass
    return iso_date(raw_value) or iso_date(row.get("date"))


def slugify(value: str, fallback: str = "item") -> str:
    normalized = unicodedata.normalize("NFKD", html.unescape(value)).encode("ascii", "ignore").decode("ascii")
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()
    return normalized[:180] or fallback


def normalize_title(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", html.unescape(value).replace("&", " and ")).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", normalized.lower()).strip()


def canonical_episode_title(value: str) -> str:
    normalized = normalize_title(value)
    normalized = re.sub(r"^(?:best\s+of|bestof)\s+", "", normalized)
    normalized = re.sub(r"\b(?:part|pt)\s+(?:one|1)\b", "1", normalized)
    normalized = re.sub(r"\b(?:part|pt)\s+(?:two|2)\b", "2", normalized)
    normalized = re.sub(r"\b(?:part|pt)\s+(?:three|3)\b", "3", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def basename_key(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    path = urllib.parse.unquote(parsed.path or value).replace("\\", "/")
    return PurePosixPath(path).name.casefold()


def stable_fingerprint(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def strip_markup(value: str) -> str:
    without_shortcodes = re.sub(r"\[(?:/?)[A-Za-z0-9_:-]+[^\]]*\]", " ", value)
    without_tags = re.sub(r"<[^>]+>", " ", without_shortcodes)
    return re.sub(r"\s+", " ", html.unescape(without_tags)).strip()


def clean_legacy_content(value: str) -> str:
    """Remove WordPress/Divi wrappers while retaining authored HTML and inner copy."""
    cleaned = re.sub(r"<!--(?:.|\n)*?-->", "", value)
    cleaned = re.sub(r"<\?(?:php)?(?:.|\n)*?\?>", "", cleaned, flags=re.I)
    cleaned = re.sub(r"<(script|style|object|embed|form)\b[^>]*>(?:.|\n)*?</\1\s*>", "", cleaned, flags=re.I)
    cleaned = re.sub(r"<(?:script|style|object|embed|form)\b[^>]*/?>", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\[(?:/)?[A-Za-z0-9_:-]+(?:\s+[^\]]*)?\]", "", cleaned)
    cleaned = re.sub(r"\s+on[A-Za-z]+\s*=\s*(?:\"[^\"]*\"|'[^']*')", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s+(?:href|src)\s*=\s*([\"'])\s*javascript:[^\"']*\1", "", cleaned, flags=re.I)

    upload_pattern = re.compile(r"(?:https?:)?//(?:www\.)?pastorwood\.org/wp-content/uploads/[^\s\"'<>]+", re.I)

    def local_upload(match: re.Match[str]) -> str:
        relative = safe_upload_relative_path(match.group(0))
        return f"/media/legacy/{relative}" if relative else ""

    cleaned = upload_pattern.sub(local_upload, cleaned)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def safe_upload_relative_path(value: str) -> str | None:
    raw = urllib.parse.unquote(value).replace("\\", "/").strip()
    marker = "/wp-content/uploads/"
    if marker in raw:
        raw = raw.split(marker, 1)[1]
    raw = raw.lstrip("/")
    try:
        path = PurePosixPath(raw)
    except ValueError:
        return None
    if not raw or path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        return None
    if any(part.casefold() in PRIVATE_MEDIA_SEGMENTS for part in path.parts):
        return None
    if any(ord(character) < 32 for character in raw):
        return None
    return path.as_posix()


def normalize_legacy_url(raw_value: str) -> tuple[str, str]:
    cleaned = html.unescape(raw_value.strip())
    cleaned = re.sub(r'\s*"\s*\?>\s*$', "", cleaned)
    if not cleaned:
        raise ValueError("empty legacy URL")
    parsed = urllib.parse.urlsplit(cleaned if "://" in cleaned else f"{LEGACY_ORIGIN}/{cleaned.lstrip('/')}")
    host = (parsed.hostname or "").casefold()
    if host not in {"pastorwood.org", "www.pastorwood.org"}:
        raise ValueError("legacy URL is outside pastorwood.org")
    decoded_path = urllib.parse.unquote(parsed.path or "/")
    decoded_path = re.sub(r"/{2,}", "/", decoded_path)
    if not decoded_path.startswith("/") or any(ord(character) < 32 for character in decoded_path):
        raise ValueError("invalid legacy path")
    if decoded_path != "/" and not PurePosixPath(decoded_path).suffix:
        decoded_path = decoded_path.rstrip("/") + "/"
    source_url = urllib.parse.urlunsplit(("https", "www.pastorwood.org", decoded_path, parsed.query, ""))
    return decoded_path, source_url


def safe_redirect_target(source_path: str, target: str) -> str:
    normalized = target.strip()
    if not normalized.startswith("/") or normalized.startswith("//") or "\\" in normalized:
        raise ValueError("redirect targets must be site-relative")
    target_path = urllib.parse.urlsplit(normalized).path
    if is_reserved_route(target_path):
        raise ValueError("redirect target enters a reserved route")
    if target_path != "/" and not PurePosixPath(target_path).suffix:
        target_path = target_path.rstrip("/") + "/"
    if source_path.rstrip("/").casefold() == target_path.rstrip("/").casefold():
        return target_path
    return target_path


def is_reserved_route(path: str) -> bool:
    normalized = path.rstrip("/") or "/"
    return any(normalized == prefix or normalized.startswith(prefix + "/") for prefix in RESERVED_REDIRECT_PREFIXES)


def match_episodes(aic_rows: Sequence[dict[str, Any]], wp_sermons: Sequence[dict[str, Any]]) -> list[EpisodeMatch]:
    by_audio: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    by_title: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    by_canonical: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    by_date: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for sermon in wp_sermons:
        meta = sermon.get("meta") if isinstance(sermon.get("meta"), dict) else {}
        audio = basename_key(text(meta.get("sermon_audio")))
        if audio:
            by_audio[audio].append(sermon)
        by_title[normalize_title(text(sermon.get("title")))].append(sermon)
        by_canonical[canonical_episode_title(text(sermon.get("title")))].append(sermon)
        by_date[wordpress_sermon_date(sermon)].append(sermon)

    candidates: list[tuple[float, str, str, str]] = []
    for episode in aic_rows:
        track_id = text(episode.get("trackId"))
        title_key = normalize_title(text(episode.get("title")))
        canonical_key = canonical_episode_title(text(episode.get("title")))
        episode_date = iso_date(episode.get("publishDate"))
        audio_key = basename_key(text(episode.get("sourceFile")))
        for sermon in by_audio.get(audio_key, []):
            candidates.append((500.0, track_id, text(sermon.get("id")), "audio-basename"))
        for sermon in by_title.get(title_key, []):
            same_date = wordpress_sermon_date(sermon) == episode_date
            method = "normalized-title-date" if same_date else "normalized-title"
            candidates.append((440.0 if same_date else 400.0, track_id, text(sermon.get("id")), method))
        if canonical_key != title_key:
            for sermon in by_canonical.get(canonical_key, []):
                same_date = wordpress_sermon_date(sermon) == episode_date
                method = "canonical-title-date" if same_date else "canonical-title"
                candidates.append((360.0 if same_date else 330.0, track_id, text(sermon.get("id")), method))
        for sermon in by_date.get(episode_date, []):
            sermon_key = canonical_episode_title(text(sermon.get("title")))
            ratio = difflib.SequenceMatcher(None, canonical_key, sermon_key, autojunk=False).ratio()
            if ratio >= 0.90:
                candidates.append((200.0 + ratio, track_id, text(sermon.get("id")), "fuzzy-title-date"))

    used_aic: set[str] = set()
    used_wp: set[str] = set()
    matches: list[EpisodeMatch] = []
    for _score, track_id, wp_id, method in sorted(candidates, key=lambda item: (-item[0], item[1], item[2])):
        if not track_id or not wp_id or track_id in used_aic or wp_id in used_wp:
            continue
        used_aic.add(track_id)
        used_wp.add(wp_id)
        matches.append(EpisodeMatch(track_id, wp_id, method))
    return sorted(matches, key=lambda match: match.aic_track_id)


def unique_slugs(rows: list[dict[str, Any]], identity_field: str) -> None:
    used: dict[str, str] = {}
    for row in rows:
        base = slugify(text(row.get("slug")) or text(row.get("title")), text(row.get(identity_field)) or "item")
        identity = text(row.get(identity_field))
        candidate = base
        if candidate in used and used[candidate] != identity:
            suffix = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:8]
            candidate = f"{base[:170]}-{suffix}"
        row["slug"] = candidate
        used[candidate] = identity


def build_pages(wp_content: Sequence[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    pages: list[dict[str, Any]] = []
    excluded: list[dict[str, str]] = []
    claimed_keys: set[str] = set()
    for row in wp_content:
        if text(row.get("type")) != "page":
            continue
        legacy_id = text(row.get("id"))
        slug = slugify(text(row.get("slug")), f"page-{legacy_id}")
        if slug in OPERATIONAL_PAGE_SLUGS:
            excluded.append({"legacyId": legacy_id, "slug": slug, "reason": "operational-or-commerce-page"})
            continue
        body = clean_legacy_content(text(row.get("content")))
        excerpt = clean_legacy_content(text(row.get("excerpt")))
        raw_title = text(row.get("title"))
        if not raw_title and not strip_markup(body) and not strip_markup(excerpt):
            excluded.append({"legacyId": legacy_id, "slug": slug, "reason": "contentless-page"})
            continue
        page_key = FIXED_PAGE_KEYS.get(slug, f"legacy-page-{legacy_id}")
        if page_key in claimed_keys:
            excluded.append({"legacyId": legacy_id, "slug": slug, "reason": "duplicate-fixed-page-identity"})
            continue
        claimed_keys.add(page_key)
        title = raw_title or slug.replace("-", " ").title()
        meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
        target = FIXED_PAGE_TARGETS.get(slug, f"/{slug}/")
        pages.append({
            "pageKey": page_key,
            "slug": target.strip("/") or "home",
            "title": title,
            "active": True,
            "showInNavigation": slug in {"about-pastor-wood", "abiding-in-christ", "radio", "contact"},
            "navigationLabel": title,
            "navigationOrder": len(pages),
            "heroLabel": "Abiding in Christ",
            "heroTitle": title,
            "heroBody": strip_markup(excerpt)[:320],
            "seoTitle": text(meta.get("_aioseo_title")) or title,
            "seoDescription": text(meta.get("_aioseo_description")) or strip_markup(excerpt or body)[:175],
            "legacyUrl": f"{LEGACY_ORIGIN}/{slug}/",
            "legacyId": legacy_id,
            "canonicalUrl": f"{LEGACY_ORIGIN}{target}",
            "sections": ([{
                "__component": "page-sections.text-section",
                "eyebrow": "",
                "heading": "",
                "body": body,
            }] if body else []),
        })
    return pages, excluded


def wordpress_post_kind(row: dict[str, Any]) -> str:
    categories = {text(value) for value in row.get("categories", []) if isinstance(value, str)}
    if "weekly-devotional" in categories:
        return "devotional"
    if "resources" in categories:
        return "written-resource"
    return "article"


def build_posts(
    wp_content: Sequence[dict[str, Any]],
    aic_posts: Sequence[dict[str, Any]],
    collapsed_aic_posts: list[dict[str, Any]] | None = None,
    aic_post_reconciliation: list[dict[str, str]] | None = None,
) -> list[dict[str, Any]]:
    by_legacy_id: dict[str, dict[str, Any]] = {}
    by_source_url: dict[str, str] = {}
    for row in wp_content:
        if text(row.get("type")) != "post":
            continue
        legacy_id = text(row.get("id"))
        meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
        slug = slugify(text(row.get("slug")), f"post-{legacy_id}")
        publish_date = iso_date(row.get("date"))
        source_url = f"{LEGACY_ORIGIN}/{publish_date[:4]}/{publish_date[5:7]}/{slug}/" if publish_date else f"{LEGACY_ORIGIN}/{slug}/"
        body = clean_legacy_content(text(row.get("content")))
        excerpt = clean_legacy_content(text(row.get("excerpt")))
        record = {
            "legacyId": legacy_id,
            "title": text(row.get("title")) or slug.replace("-", " ").title(),
            "slug": slug,
            "contentType": wordpress_post_kind(row),
            "summary": strip_markup(excerpt or body)[:600],
            "body": body,
            "publishDate": iso_datetime(row.get("dateGmt") or row.get("date")),
            "legacyUrl": source_url,
            "canonicalUrl": f"{LEGACY_ORIGIN}/writings/{slug}/",
            "seo": {
                "title": text(meta.get("_aioseo_title")) or text(row.get("title")),
                "description": text(meta.get("_aioseo_description")) or strip_markup(excerpt or body)[:175],
                "canonicalUrl": f"{LEGACY_ORIGIN}/writings/{slug}/",
                "noIndex": False,
            },
            "sourceFingerprint": "",
        }
        record["sourceFingerprint"] = stable_fingerprint(record)
        by_legacy_id[legacy_id] = record
        by_source_url[source_url.rstrip("/")] = legacy_id

    aic_groups: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in aic_posts:
        aic_groups[text(row.get("postId"))].append(row)
    aic_winners: list[dict[str, Any]] = []
    for post_id, rows in sorted(aic_groups.items()):
        ordered = sorted(rows, key=lambda row: (
            text(row.get("updatedAt")), text(row.get("modifiedAt")), text(row.get("publishedAt")),
            stable_fingerprint(row),
        ))
        winner = ordered[-1]
        aic_winners.append(winner)
        if collapsed_aic_posts is not None:
            winner_content_fingerprint = stable_fingerprint({
                "title": text(winner.get("title")),
                "sourceUrl": text(winner.get("sourceUrl")).rstrip("/"),
                "body": text(winner.get("contentHtml")) or text(winner.get("text")),
            })
            for row in ordered[:-1]:
                row_content_fingerprint = stable_fingerprint({
                    "title": text(row.get("title")),
                    "sourceUrl": text(row.get("sourceUrl")).rstrip("/"),
                    "body": text(row.get("contentHtml")) or text(row.get("text")),
                })
                collapsed_aic_posts.append({
                    "postId": post_id,
                    "sourceUrl": text(row.get("sourceUrl")),
                    "keptSourceUrl": text(winner.get("sourceUrl")),
                    "reason": "duplicate-aic-post-id-older-revision",
                    "contentFingerprint": row_content_fingerprint,
                    "keptContentFingerprint": winner_content_fingerprint,
                    "contentEquivalent": row_content_fingerprint == winner_content_fingerprint,
                })

    for row in aic_winners:
        legacy_id = text(row.get("postId"))
        source_url = text(row.get("sourceUrl")).rstrip("/")
        matched_by = "post-id" if legacy_id in by_legacy_id else "source-url" if by_source_url.get(source_url, "") else "aic-only"
        existing_id = legacy_id if matched_by == "post-id" else by_source_url.get(source_url, "")
        slug = slugify(text(row.get("slug")), f"post-{legacy_id}")
        source_type = text(row.get("sourceType"))
        content_type = "devotional" if source_type == "pastorwood_devotional" else "written-resource"
        record = {
            "legacyId": legacy_id,
            "title": text(row.get("title")) or slug.replace("-", " ").title(),
            "slug": slug,
            "contentType": content_type,
            "summary": text(row.get("summary")) or strip_markup(clean_legacy_content(text(row.get("excerptHtml"))))[:600],
            "body": clean_legacy_content(text(row.get("contentHtml")) or text(row.get("text"))),
            "publishDate": iso_datetime(row.get("publishedAt")) or iso_datetime(row.get("publishDate")),
            "legacyUrl": text(row.get("sourceUrl")),
            "canonicalUrl": f"{LEGACY_ORIGIN}/writings/{slug}/",
            "seo": {
                "title": text(row.get("title")),
                "description": text(row.get("summary"))[:175] or strip_markup(clean_legacy_content(text(row.get("excerptHtml"))))[:175],
                "canonicalUrl": f"{LEGACY_ORIGIN}/writings/{slug}/",
                "noIndex": False,
            },
            "sourceFingerprint": "",
        }
        record["sourceFingerprint"] = stable_fingerprint(record)
        if existing_id and existing_id != legacy_id:
            by_legacy_id.pop(existing_id, None)
        by_legacy_id[legacy_id] = record
        if aic_post_reconciliation is not None:
            aic_post_reconciliation.append({
                "postId": legacy_id,
                "sourceUrl": text(row.get("sourceUrl")),
                "status": "aic-only-added" if matched_by == "aic-only" else "aic-supersedes-wordpress",
                "matchedBy": matched_by,
                "sourceFingerprint": record["sourceFingerprint"],
            })
    posts = list(by_legacy_id.values())
    unique_slugs(posts, "legacyId")
    for record in posts:
        record["sourceFingerprint"] = ""
        record["sourceFingerprint"] = stable_fingerprint(record)
    return sorted(posts, key=lambda row: (text(row.get("publishDate")), text(row.get("legacyId"))))


def sermon_audio_relative(sermon: dict[str, Any]) -> str | None:
    meta = sermon.get("meta") if isinstance(sermon.get("meta"), dict) else {}
    return safe_upload_relative_path(text(meta.get("sermon_audio")))


def build_episodes(
    wp_content: Sequence[dict[str, Any]],
    aic_episodes: Sequence[dict[str, Any]],
    reconciliation: list[dict[str, str]] | None = None,
) -> tuple[list[dict[str, Any]], list[EpisodeMatch]]:
    sermons = [row for row in wp_content if text(row.get("type")) == "wpfc_sermon"]
    sermons_by_id = {text(row.get("id")): row for row in sermons}
    matches = match_episodes(aic_episodes, sermons)
    wp_by_track = {match.aic_track_id: sermons_by_id[match.wp_sermon_id] for match in matches}
    episodes: list[dict[str, Any]] = []

    for row in aic_episodes:
        track_id = text(row.get("trackId"))
        sermon = wp_by_track.get(track_id)
        meta = sermon.get("meta") if sermon and isinstance(sermon.get("meta"), dict) else {}
        slug = slugify(text(sermon.get("slug")) if sermon else text(row.get("title")), f"episode-{track_id}")
        relative_audio = sermon_audio_relative(sermon) if sermon else None
        summary = text(meta.get("sermon_description")) or strip_markup(text(row.get("detail")))[:600]
        program_date = wordpress_sermon_date(sermon) if sermon else iso_date(row.get("publishDate"))
        wp_id = text(sermon.get("id")) if sermon else ""
        record = {
            "trackId": track_id,
            "legacyId": f"aic:{track_id}",
            "wpSermonId": wp_id,
            "title": text(row.get("title")) or text(sermon.get("title")) or track_id,
            "slug": slug,
            "programDate": program_date or None,
            "summary": summary,
            "description": text(meta.get("sermon_description")) or text(row.get("detail")),
            "externalAudioUrl": f"/media/episodes/{track_id}" if re.fullmatch(r"(?:\d+|sa_\d+)", track_id) else "",
            "publishDate": iso_datetime(row.get("publishDate")),
            "legacyUrl": f"{LEGACY_ORIGIN}/radio/{slug}/" if sermon else "",
            "canonicalUrl": f"{LEGACY_ORIGIN}/radio/{slug}/",
            "seo": {
                "title": text(meta.get("_aioseo_title")) or text(row.get("title")),
                "description": text(meta.get("_aioseo_description")) or summary[:175],
                "canonicalUrl": f"{LEGACY_ORIGIN}/radio/{slug}/",
                "noIndex": False,
            },
            "sourceFingerprint": "",
        }
        record["sourceFingerprint"] = stable_fingerprint(record)
        episodes.append(record)

    matched_wp_ids = {match.wp_sermon_id for match in matches}
    aic_audio: defaultdict[str, list[str]] = defaultdict(list)
    aic_title_date: defaultdict[tuple[str, str], list[str]] = defaultdict(list)
    for row in aic_episodes:
        track_id = text(row.get("trackId"))
        audio_key = basename_key(text(row.get("sourceFile")))
        if audio_key:
            aic_audio[audio_key].append(track_id)
        title_date = (canonical_episode_title(text(row.get("title"))), iso_date(row.get("publishDate")))
        if all(title_date):
            aic_title_date[title_date].append(track_id)

    seen_wp_evidence: dict[tuple[str, ...], str] = {}
    for sermon in sorted(sermons, key=lambda row: int(text(row.get("id"))) if text(row.get("id")).isdigit() else 0):
        wp_id = text(sermon.get("id"))
        if wp_id in matched_wp_ids:
            continue
        relative_audio = sermon_audio_relative(sermon)
        audio_key = basename_key(relative_audio or "")
        title_key = canonical_episode_title(text(sermon.get("title")))
        program_date = wordpress_sermon_date(sermon)
        evidence_fingerprint = stable_fingerprint({"audio": relative_audio or "", "title": title_key, "date": program_date})
        duplicate_tracks = aic_audio.get(audio_key, []) if audio_key else []
        duplicate_reason = "aic-audio-basename" if duplicate_tracks else ""
        if not duplicate_tracks and title_key and program_date:
            duplicate_tracks = aic_title_date.get((title_key, program_date), [])
            duplicate_reason = "aic-canonical-title-date" if duplicate_tracks else ""
        if duplicate_tracks:
            if reconciliation is not None:
                reconciliation.append({
                    "wpSermonId": wp_id,
                    "status": "duplicate-aic",
                    "reason": duplicate_reason,
                    "canonicalTrackId": sorted(duplicate_tracks)[0],
                    "evidenceFingerprint": evidence_fingerprint,
                })
            continue

        wp_key = ("audio-path", relative_audio) if relative_audio else (("title-date", title_key, program_date) if title_key and program_date else ("wp-id", wp_id))
        representative = seen_wp_evidence.get(wp_key)
        if representative:
            if reconciliation is not None:
                reconciliation.append({
                    "wpSermonId": wp_id,
                    "status": "duplicate-wordpress",
                    "reason": wp_key[0],
                    "canonicalWpSermonId": representative,
                    "evidenceFingerprint": evidence_fingerprint,
                })
            continue
        seen_wp_evidence[wp_key] = wp_id
        meta = sermon.get("meta") if isinstance(sermon.get("meta"), dict) else {}
        slug = slugify(text(sermon.get("slug")), f"sermon-{wp_id}")
        summary = text(meta.get("sermon_description")) or strip_markup(clean_legacy_content(text(sermon.get("content"))))[:600]
        record = {
            "trackId": f"wp-sermon:{wp_id}",
            "legacyId": f"wp-sermon:{wp_id}",
            "wpSermonId": wp_id,
            "title": text(sermon.get("title")) or f"Legacy radio episode {wp_id}",
            "slug": slug,
            "programDate": program_date or None,
            "summary": summary,
            "description": text(meta.get("sermon_description")) or clean_legacy_content(text(sermon.get("content"))),
            "externalAudioUrl": f"/media/legacy/{relative_audio}" if relative_audio else "",
            "publishDate": iso_datetime(sermon.get("dateGmt") or sermon.get("date")),
            "legacyUrl": f"{LEGACY_ORIGIN}/radio/{slug}/",
            "canonicalUrl": f"{LEGACY_ORIGIN}/radio/{slug}/",
            "seo": {
                "title": text(meta.get("_aioseo_title")) or text(sermon.get("title")),
                "description": text(meta.get("_aioseo_description")) or summary[:175],
                "canonicalUrl": f"{LEGACY_ORIGIN}/radio/{slug}/",
                "noIndex": False,
            },
            "sourceFingerprint": "",
        }
        record["sourceFingerprint"] = stable_fingerprint(record)
        episodes.append(record)
        if reconciliation is not None:
            reconciliation.append({
                "wpSermonId": wp_id,
                "status": "imported-unique",
                "reason": wp_key[0],
                "canonicalTrackId": record["trackId"],
                "evidenceFingerprint": evidence_fingerprint,
            })

    unique_slugs(episodes, "trackId")
    for record in episodes:
        record["sourceFingerprint"] = ""
        record["sourceFingerprint"] = stable_fingerprint(record)
    return sorted(episodes, key=lambda row: text(row.get("trackId"))), matches


def reconcile_episode_media(episodes: list[dict[str, Any]], media_records: Sequence[MediaRecord]) -> list[dict[str, str]]:
    verified = {record.relative_path for record in media_records if record.visibility == "public" and record.exists}
    missing: list[dict[str, str]] = []
    for episode in episodes:
        audio_url = text(episode.get("externalAudioUrl"))
        if not audio_url.startswith("/media/legacy/"):
            continue
        relative = audio_url.removeprefix("/media/legacy/")
        if relative not in verified:
            missing.append({"trackId": text(episode.get("trackId")), "relativePath": relative, "reason": "not-in-verified-public-manifest"})
            episode["externalAudioUrl"] = ""
        episode["sourceFingerprint"] = ""
        episode["sourceFingerprint"] = stable_fingerprint(episode)
    return missing


def shortcode_attributes(value: str) -> dict[str, str]:
    return {
        key: html.unescape(attribute_value).strip()
        for key, attribute_value in re.findall(r'([A-Za-z0-9_:-]+)="([^"]*)"', value)
    }


def build_people_and_endorsements(
    wp_content: Sequence[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    people: list[dict[str, Any]] = []
    endorsements: list[dict[str, Any]] = []
    team_pattern = re.compile(r"\[et_pb_team_member\s+([^\]]*)\](.*?)\[/et_pb_team_member\]", re.I | re.S)
    testimonial_pattern = re.compile(r"\[et_pb_testimonial\s+([^\]]*)\](.*?)\[/et_pb_testimonial\]", re.I | re.S)
    for page in wp_content:
        if text(page.get("type")) != "page":
            continue
        page_id = text(page.get("id"))
        page_slug = slugify(text(page.get("slug")), f"page-{page_id}")
        content = text(page.get("content"))
        if page_slug == "board-members":
            for index, match in enumerate(team_pattern.finditer(content), start=1):
                attributes = shortcode_attributes(match.group(1))
                name = text(attributes.get("name"))
                if not name:
                    continue
                biography = strip_markup(match.group(2))
                legacy_id = f"wp-page:{page_id}:board:{index}"
                people.append({
                    "legacyId": legacy_id,
                    "name": name,
                    "slug": slugify(name, f"board-member-{index}"),
                    "title": text(attributes.get("position")),
                    "organization": "",
                    "biography": biography,
                    "website": text(attributes.get("url")),
                    "roles": ["board"],
                    "showOnBoard": True,
                    "sortOrder": index,
                    "active": True,
                    "legacyUrl": f"{LEGACY_ORIGIN}/board-members/",
                    "legacyPhotoUrl": text(attributes.get("image_url")),
                })

        for index, match in enumerate(testimonial_pattern.finditer(content), start=1):
            attributes = shortcode_attributes(match.group(1))
            attribution = text(attributes.get("author")) or text(attributes.get("admin_label")).removeprefix("Endorsement:").strip()
            quote = strip_markup(match.group(2)).strip(" “\"”")
            if not attribution or len(quote) < 20:
                continue
            legacy_id = f"wp-page:{page_id}:endorsement:{index}"
            endorsements.append({
                "legacyId": legacy_id,
                "quote": quote,
                "attribution": attribution,
                "title": text(attributes.get("job_title")),
                "organization": text(attributes.get("company_name")),
                "sourceUrl": text(attributes.get("url")) or f"{LEGACY_ORIGIN}/{page_slug}/",
                "sortOrder": len(endorsements) + 1,
                "featured": page_slug == "abiding-in-christ" and len(endorsements) < 4,
                "active": True,
            })

    unique_slugs(people, "legacyId")
    seen_endorsements: set[tuple[str, str]] = set()
    deduped_endorsements: list[dict[str, Any]] = []
    for endorsement in endorsements:
        key = (normalize_title(text(endorsement.get("attribution"))), normalize_title(text(endorsement.get("quote"))))
        if key in seen_endorsements:
            continue
        seen_endorsements.add(key)
        deduped_endorsements.append(endorsement)
    return people, deduped_endorsements


def extract_upload_references(wp_content: Sequence[dict[str, Any]]) -> defaultdict[str, set[str]]:
    references: defaultdict[str, set[str]] = defaultdict(set)
    url_pattern = re.compile(r"(?:https?:)?//(?:www\.)?pastorwood\.org/wp-content/uploads/[^\s\"'<>]+", re.I)
    for row in wp_content:
        source = f"{text(row.get('type'))}:{text(row.get('id'))}"
        fields = [text(row.get("content")), text(row.get("excerpt"))]
        meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
        fields.extend(text(value) for value in meta.values())
        for field in fields:
            for match in url_pattern.findall(field):
                relative = safe_upload_relative_path(match)
                if relative:
                    references[relative].add(source)
        audio = safe_upload_relative_path(text(meta.get("sermon_audio")))
        if audio:
            references[audio].add(source)
    return references


def read_manifest_urls(path: Path) -> list[str]:
    return [line.strip() for line in path.read_text(encoding="utf-8", errors="replace").splitlines() if line.strip()]


def build_media_records(
    attachments: Sequence[dict[str, Any]],
    attachment_urls: Sequence[str],
    legacy_urls: Sequence[str],
    references: defaultdict[str, set[str]],
    restricted_root: Path,
    verify: bool,
) -> tuple[list[MediaRecord], list[dict[str, str]]]:
    allowed_paths: dict[str, str] = {}
    rejected: list[dict[str, str]] = []
    for url in attachment_urls:
        relative = safe_upload_relative_path(url)
        if not relative:
            rejected.append({"source": url, "reason": "unsafe-or-private-path"})
            continue
        allowed_paths[relative] = url

    public_sitemap_paths = {
        relative
        for url in legacy_urls
        if (relative := safe_upload_relative_path(url)) and relative in allowed_paths
    }
    attachment_by_path: dict[str, dict[str, Any]] = {}
    for attachment in attachments:
        meta = attachment.get("meta") if isinstance(attachment.get("meta"), dict) else {}
        relative = safe_upload_relative_path(text(meta.get("_wp_attached_file")) or text(attachment.get("guid")))
        if relative and relative in allowed_paths:
            attachment_by_path[relative] = attachment

    records: list[MediaRecord] = []
    for index, relative in enumerate(sorted(allowed_paths)):
        attachment = attachment_by_path.get(relative, {})
        attachment_id = text(attachment.get("id")) or f"manifest-{index + 1}"
        referenced_by = set(references.get(relative, set()))
        if relative in public_sitemap_paths:
            referenced_by.add("legacy-public-sitemap")
        visibility = "public" if referenced_by else "private"
        source_path = restricted_root / Path(*PurePosixPath(relative).parts)
        exists = source_path.is_file() if verify else False
        size = source_path.stat().st_size if exists else None
        records.append(MediaRecord(
            attachment_id=attachment_id,
            title=text(attachment.get("title")) or PurePosixPath(relative).name,
            relative_path=relative,
            source_url=allowed_paths[relative],
            mime_type=text(attachment.get("mimeType")) or mimetypes.guess_type(relative)[0] or "application/octet-stream",
            visibility=visibility,
            referenced_by=tuple(sorted(referenced_by)),
            exists=exists,
            size_bytes=size,
        ))
    return records, rejected


def redirect_target_for(
    path: str,
    post_slug_targets: dict[str, str],
    sermon_slug_targets: dict[str, str],
    public_media_paths: set[str],
) -> tuple[str | None, str]:
    if "/wp-content/uploads/" in path:
        relative_media = safe_upload_relative_path(path)
        if relative_media in public_media_paths:
            return f"/media/legacy/{relative_media}", "public-attachment"
        return None, "private-or-unpublished-attachment"

    parts = [part for part in path.strip("/").split("/") if part]
    final_slug = slugify(parts[-1], "") if parts else ""
    if len(parts) >= 3 and re.fullmatch(r"\d{4}", parts[0]) and re.fullmatch(r"\d{2}", parts[1]):
        target = post_slug_targets.get(final_slug)
        if target:
            return target, "published-writing"
    if parts and parts[0] == "radio":
        if len(parts) == 1:
            return "/radio/", "fixed-page"
        target = sermon_slug_targets.get(final_slug)
        if target:
            return target, "published-episode"
        return None, "unmatched-radio-item"
    if final_slug in FIXED_PAGE_TARGETS:
        return FIXED_PAGE_TARGETS[final_slug], "fixed-page"
    if final_slug in post_slug_targets:
        return post_slug_targets[final_slug], "published-writing"
    if final_slug in sermon_slug_targets:
        return sermon_slug_targets[final_slug], "published-episode"
    if path.startswith("/category/weekly-devotional") or path.startswith("/tag/"):
        return "/bible-study/", "taxonomy-fallback"
    if path.startswith("/author/"):
        return "/about-pastor-wood/", "author-fallback"
    if "sitemap" in path:
        return "/sitemap.xml", "sitemap"
    if path.endswith("/feed/") or path == "/feed/":
        return "/radio/", "feed-fallback"
    return None, "no-equivalent-public-target"


def build_redirects(
    legacy_urls: Sequence[str],
    wp_content: Sequence[dict[str, Any]],
    posts: Sequence[dict[str, Any]],
    episodes: Sequence[dict[str, Any]],
    media_records: Sequence[MediaRecord],
) -> tuple[list[dict[str, Any]], list[dict[str, str]], list[dict[str, str]]]:
    post_slug_targets = {text(row.get("slug")): f"/writings/{text(row.get('slug'))}/" for row in posts}
    sermon_slug_targets: dict[str, str] = {}
    episode_by_wp = {text(row.get("wpSermonId")): row for row in episodes if text(row.get("wpSermonId"))}
    for row in wp_content:
        if text(row.get("type")) != "wpfc_sermon":
            continue
        target_episode = episode_by_wp.get(text(row.get("id")))
        if target_episode:
            sermon_slug_targets[slugify(text(row.get("slug")), "")] = f"/radio/{text(target_episode.get('slug'))}/"
    public_media_paths = {record.relative_path for record in media_records if record.visibility == "public" and record.exists}

    redirects: dict[str, dict[str, Any]] = {}
    failures: list[dict[str, str]] = []
    unmatched: list[dict[str, str]] = []
    for input_index, raw_url in enumerate(legacy_urls, start=1):
        try:
            path, source_url = normalize_legacy_url(raw_url)
            if is_reserved_route(path):
                raise ValueError("legacy source overlaps a current reserved route")
            target, reason = redirect_target_for(path, post_slug_targets, sermon_slug_targets, public_media_paths)
            if not target:
                unmatched.append({"line": str(input_index), "source": source_url, "reason": reason})
                continue
            target = safe_redirect_target(path, target)
            if path.rstrip("/").casefold() == target.rstrip("/").casefold():
                unmatched.append({"line": str(input_index), "source": source_url, "reason": "already-canonical-self"})
                continue
        except ValueError as error:
            failures.append({"line": str(input_index), "source": raw_url, "reason": str(error)})
            continue
        redirects[path] = {
            "fromPath": path,
            "toPath": target,
            "statusCode": 301,
            "active": True,
            "sourceUrl": source_url,
            "notes": reason,
        }
    return sorted(redirects.values(), key=lambda row: text(row.get("fromPath"))), failures, unmatched


def media_manifest_entry(record: MediaRecord) -> dict[str, Any]:
    return {
        "relativePath": record.relative_path,
        "publicPath": f"/media/legacy/{record.relative_path}" if record.visibility == "public" else "",
        "sourceUrl": record.source_url,
        "legacyAttachmentId": record.attachment_id,
        "visibility": record.visibility,
        "mimeType": record.mime_type,
        "sizeBytes": record.size_bytes,
        "exists": record.exists,
        "referencedBy": list(record.referenced_by),
    }


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


class StrapiClient:
    def __init__(self, base_url: str, token: str):
        if not base_url or not token:
            raise RuntimeError("Applying requires STRAPI_URL and a scoped Strapi management token")
        self.base_url = base_url.rstrip("/")
        self.token = token

    def request(self, path: str, method: str = "GET", payload: dict[str, Any] | None = None) -> Any:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
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
            with urllib.request.urlopen(request, timeout=30) as response:
                response_body = response.read().decode("utf-8")
                return json.loads(response_body) if response_body else None
        except urllib.error.HTTPError as error:
            detail = error.read(800).decode("utf-8", errors="replace")
            raise RuntimeError(f"Strapi {method} {path} failed ({error.code}): {detail}") from error

    def upsert(
        self,
        api_path: str,
        identity_field: str,
        identity_value: str,
        data: dict[str, Any],
        publishable: bool = True,
    ) -> str:
        query = urllib.parse.urlencode({
            f"filters[{identity_field}][$eq]": identity_value,
            "pagination[pageSize]": "1",
            **({"status": "draft"} if publishable else {}),
        })
        response = self.request(f"/api/{api_path}?{query}") or {}
        matches = response.get("data") if isinstance(response, dict) else []
        existing = matches[0] if isinstance(matches, list) and matches else None
        document_id = text(existing.get("documentId")) if isinstance(existing, dict) else ""
        status_query = "?status=published" if publishable else ""
        if document_id:
            self.request(f"/api/{api_path}/{urllib.parse.quote(document_id)}{status_query}", "PUT", {"data": data})
            return "updated"
        self.request(f"/api/{api_path}{status_query}", "POST", {"data": data})
        return "created"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def copy_public_media(record: MediaRecord, restricted_root: Path, public_root: Path) -> tuple[str, int]:
    if record.visibility != "public":
        return "", 0
    relative = safe_upload_relative_path(record.relative_path)
    if not relative:
        raise RuntimeError(f"unsafe media path: {record.relative_path}")
    source = (restricted_root / Path(*PurePosixPath(relative).parts)).resolve()
    restricted = restricted_root.resolve()
    if source.parent != restricted and restricted not in source.parents:
        raise RuntimeError("media source escaped the restricted root")
    if not source.is_file() or source.is_symlink():
        raise RuntimeError(f"allowlisted source file is missing or is a symlink: {relative}")
    destination = public_root / Path(*PurePosixPath(relative).parts)
    destination.parent.mkdir(parents=True, exist_ok=True)
    source_checksum = sha256_file(source)
    if not destination.is_file() or sha256_file(destination) != source_checksum:
        temporary = destination.with_name(f".{destination.name}.tmp")
        shutil.copy2(source, temporary)
        if sha256_file(temporary) != source_checksum:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(f"checksum verification failed while copying {relative}")
        temporary.replace(destination)
    destination_checksum = sha256_file(destination)
    if destination_checksum != source_checksum:
        raise RuntimeError(f"destination checksum mismatch for {relative}")
    return source_checksum, destination.stat().st_size


def load_checkpoint(path: Path, plan_fingerprint: str, no_resume: bool = False) -> set[str]:
    if no_resume or not path.exists():
        return set()
    checkpoint_value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(checkpoint_value, dict):
        raise RuntimeError("Cutover checkpoint is invalid; use --no-resume only after review")
    if checkpoint_value.get("planFingerprint") != plan_fingerprint:
        raise RuntimeError("Cutover checkpoint belongs to a different source plan; review it and rerun with --no-resume")
    completed = checkpoint_value.get("completed")
    if not isinstance(completed, list) or not all(isinstance(item, str) for item in completed):
        raise RuntimeError("Cutover checkpoint completed list is invalid")
    return set(completed)


def apply_plan(
    args: argparse.Namespace,
    env_values: dict[str, str],
    pages: list[dict[str, Any]],
    posts: list[dict[str, Any]],
    episodes: list[dict[str, Any]],
    people: list[dict[str, Any]],
    endorsements: list[dict[str, Any]],
    media_records: list[MediaRecord],
    redirects: list[dict[str, Any]],
    plan_fingerprint: str,
) -> dict[str, Any]:
    if args.confirm != APPLY_CONFIRMATION:
        raise RuntimeError(f"--apply requires --confirm {APPLY_CONFIRMATION}")
    token = (
        env_values.get("STRAPI_API_TOKEN_TEMP_WRITE")
        or env_values.get("STRAPI_MANAGEMENT_TOKEN")
        or env_values.get("STRAPI_API_TOKEN")
        or os.environ.get("STRAPI_API_TOKEN_TEMP_WRITE", "")
        or os.environ.get("STRAPI_MANAGEMENT_TOKEN", "")
    )
    base_url = env_values.get("STRAPI_MANAGEMENT_URL") or env_values.get("STRAPI_URL") or os.environ.get("STRAPI_URL", "")
    client = StrapiClient(base_url, token)
    completed = load_checkpoint(args.checkpoint, plan_fingerprint, args.no_resume)
    results: Counter[str] = Counter()
    failures: list[dict[str, str]] = []

    def process(kind: str, identity: str, callback: Any) -> None:
        key = f"{kind}:{identity}"
        if key in completed:
            results[f"{kind}.resumed"] += 1
            return
        try:
            outcome = callback()
            results[f"{kind}.{outcome}"] += 1
            completed.add(key)
            write_json(args.checkpoint, {"version": 2, "planFingerprint": plan_fingerprint, "completed": sorted(completed)})
        except Exception as error:  # continue to create a complete bounded failure report
            failures.append({"kind": kind, "identity": identity, "error": str(error)[:1200]})
            results[f"{kind}.failed"] += 1

    for page in pages:
        process("page", text(page.get("pageKey")), lambda page=page: client.upsert("pages", "pageKey", text(page["pageKey"]), page))
    for post in posts:
        process("post", text(post.get("legacyId")), lambda post=post: client.upsert("posts", "legacyId", text(post["legacyId"]), post))
    for episode in episodes:
        process("episode", text(episode.get("trackId")), lambda episode=episode: client.upsert("episodes", "trackId", text(episode["trackId"]), episode))
    for person in people:
        process("person", text(person.get("legacyId")), lambda person=person: client.upsert("people", "legacyId", text(person["legacyId"]), person))
    for endorsement in endorsements:
        process("endorsement", text(endorsement.get("legacyId")), lambda endorsement=endorsement: client.upsert("endorsements", "legacyId", text(endorsement["legacyId"]), endorsement))
    for record in media_records:
        def apply_media(record: MediaRecord = record) -> str:
            checksum = ""
            size = record.size_bytes or 0
            if args.copy_media and record.visibility == "public":
                checksum, size = copy_public_media(record, args.restricted_media_root, args.public_media_root)
            data = {
                "title": record.title,
                "slug": slugify(record.title, f"media-{record.attachment_id}"),
                "assetType": "audio" if record.mime_type.startswith("audio/") else "image" if record.mime_type.startswith("image/") else "document",
                "visibility": record.visibility,
                "sourceUrl": record.source_url,
                "legacyAttachmentId": record.attachment_id,
                "legacyRelativePath": record.relative_path,
                "publicPath": f"/media/legacy/{record.relative_path}" if record.visibility == "public" and args.copy_media else "",
                "mimeType": record.mime_type,
                "fileSizeBytes": size or None,
                "checksumSha256": checksum,
                "usageNotes": ", ".join(record.referenced_by),
            }
            return client.upsert("media-assets", "legacyAttachmentId", record.attachment_id, data)
        process("media", record.attachment_id, apply_media)
    for redirect in redirects:
        process("redirect", text(redirect.get("fromPath")), lambda redirect=redirect: client.upsert("redirects", "fromPath", text(redirect["fromPath"]), redirect, False))

    write_json(args.failure_report, {"generatedAt": datetime.now(timezone.utc).isoformat(), "failures": failures})
    if failures:
        raise RuntimeError(f"Cutover apply completed with {len(failures)} failures; see {args.failure_report}")
    return dict(sorted(results.items()))


def build_plan(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    env_values = {**load_env_file(args.env_file), **{key: value for key, value in os.environ.items() if value}}
    wp_content, attachments = fetch_wordpress(args)
    aic_episodes, aic_posts = fetch_aic(env_values, args.aic_postgres_image)
    episode_audio_object_ids = fetch_episode_audio_object_ids(args.mc_bin, args.mc_audio_target) if args.verify_episode_audio else set()
    legacy_urls = read_manifest_urls(args.legacy_urls)
    attachment_urls = read_manifest_urls(args.attachment_manifest)
    pages, excluded_pages = build_pages(wp_content)
    collapsed_aic_posts: list[dict[str, Any]] = []
    aic_post_reconciliation: list[dict[str, str]] = []
    posts = build_posts(wp_content, aic_posts, collapsed_aic_posts, aic_post_reconciliation)
    episode_reconciliation: list[dict[str, str]] = []
    episodes, matches = build_episodes(wp_content, aic_episodes, episode_reconciliation)
    people, endorsements = build_people_and_endorsements(wp_content)
    media_records, rejected_media = build_media_records(
        attachments,
        attachment_urls,
        legacy_urls,
        extract_upload_references(wp_content),
        args.restricted_media_root,
        args.verify_media,
    )
    missing_episode_media = reconcile_episode_media(episodes, media_records)
    redirects, redirect_failures, unmatched_redirects = build_redirects(legacy_urls, wp_content, posts, episodes, media_records)
    plan_fingerprint = stable_fingerprint({
        "pages": pages,
        "posts": posts,
        "episodes": episodes,
        "people": people,
        "endorsements": endorsements,
        "media": [media_manifest_entry(record) for record in media_records],
        "redirects": redirects,
    })
    wp_counts = Counter(text(row.get("type")) for row in wp_content)
    aic_track_ids = {text(row.get("trackId")) for row in aic_episodes if re.fullmatch(r"(?:\d+|sa_\d+)", text(row.get("trackId")))}
    match_counts = Counter(match.method for match in matches)
    episode_reconciliation_counts = Counter(text(row.get("status")) for row in episode_reconciliation)
    media_counts = Counter(record.visibility for record in media_records)
    missing_public_media = [
        {
            "legacyAttachmentId": record.attachment_id,
            "relativePath": record.relative_path,
            "sourceUrl": record.source_url,
            "referencedBy": list(record.referenced_by),
        }
        for record in media_records
        if record.visibility == "public" and not record.exists
    ]
    redirect_counts = Counter(text(row.get("notes")) for row in redirects)
    redirect_self_loops = sum(1 for row in redirects if text(row.get("fromPath")).rstrip("/").casefold() == text(row.get("toPath")).rstrip("/").casefold())
    redirect_reserved_sources = sum(1 for row in redirects if is_reserved_route(text(row.get("fromPath"))))
    verified_public_media_targets = {f"/media/legacy/{record.relative_path}" for record in media_records if record.visibility == "public" and record.exists}
    nonexistent_media_targets = sum(1 for row in redirects if text(row.get("toPath")).startswith("/media/legacy/") and text(row.get("toPath")) not in verified_public_media_targets)
    plan = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "planFingerprint": plan_fingerprint,
        "precedence": {
            "posts": "AIC pastorwood_posts supersede WordPress posts by legacy id, then source URL",
            "episodes": "AIC episodes are canonical; WordPress sermons enrich one AIC episode each by audio basename, then normalized title plus date; genuinely unique unmatched WordPress sermons are imported, while duplicate leftovers are reported without creating another episode",
            "media": "only explicit attachment-manifest paths may be considered; legacy public sitemap or published-content reference is required for public visibility",
        },
        "sourceCounts": {
            "legacyPublicUrls": len(legacy_urls),
            "attachmentManifestUrls": len(attachment_urls),
            "wordpressPublishedPages": wp_counts["page"],
            "wordpressPublishedPosts": wp_counts["post"],
            "wordpressPublishedSermons": wp_counts["wpfc_sermon"],
            "wordpressAttachments": len(attachments),
            "aicEpisodes": len(aic_episodes),
            "aicPosts": len(aic_posts),
        },
        "plannedCounts": {
            "pages": len(pages),
            "posts": len(posts),
            "episodes": len(episodes),
            "episodeMatches": len(matches),
            "unmatchedWordpressSermons": max(0, wp_counts["wpfc_sermon"] - len(matches)),
            "uniqueWordpressSermonsImported": episode_reconciliation_counts["imported-unique"],
            "duplicateWordpressSermons": episode_reconciliation_counts["duplicate-aic"] + episode_reconciliation_counts["duplicate-wordpress"],
            "people": len(people),
            "endorsements": len(endorsements),
            "media": len(media_records),
            "publicMedia": media_counts["public"],
            "privateMedia": media_counts["private"],
            "redirects": len(redirects),
        },
        "matchMethods": dict(sorted(match_counts.items())),
        "postReconciliation": {
            "precedence": "group AIC rows by postId; keep the deterministically latest updated/modified revision; each AIC winner supersedes WordPress by postId, then normalized source URL",
            "collapsedAicRows": collapsed_aic_posts,
            "counts": dict(sorted(Counter(text(row.get("status")) for row in aic_post_reconciliation).items())),
            "aicOnlyRows": [row for row in aic_post_reconciliation if row.get("status") == "aic-only-added"],
        },
        "episodeReconciliation": {
            "counts": dict(sorted(episode_reconciliation_counts.items())),
            "records": episode_reconciliation,
        },
        "redirectReasons": dict(sorted(redirect_counts.items())),
        "excludedPages": excluded_pages,
        "rejectedMedia": rejected_media,
        "redirectFailures": redirect_failures,
        "unmatchedRedirects": unmatched_redirects,
        "redirectCoverage": {
            "inputUrls": len(legacy_urls),
            "matched": len(redirects),
            "unmatched": len(unmatched_redirects),
            "rejected": len(redirect_failures),
        },
        "redirectIntegrity": {
            "selfLoops": redirect_self_loops,
            "reservedSources": redirect_reserved_sources,
            "nonexistentMediaTargets": nonexistent_media_targets,
        },
        "mediaVerification": {
            "enabled": args.verify_media,
            "existing": sum(1 for record in media_records if record.exists),
            "missing": sum(1 for record in media_records if args.verify_media and not record.exists),
            "checksums": "computed and compared during --apply --copy-media only",
        },
        "episodeAudioCoverage": {
            "enabled": args.verify_episode_audio,
            "aicTrackIds": len(aic_track_ids),
            "numericTrackIds": sum(1 for track_id in aic_track_ids if track_id.isdigit()),
            "sermonAudioTrackIds": sum(1 for track_id in aic_track_ids if track_id.startswith("sa_")),
            "objects": len(episode_audio_object_ids) if args.verify_episode_audio else None,
            "found": len(aic_track_ids & episode_audio_object_ids) if args.verify_episode_audio else None,
            "missing": sorted(aic_track_ids - episode_audio_object_ids) if args.verify_episode_audio else [],
            "orphanObjects": sorted(episode_audio_object_ids - aic_track_ids) if args.verify_episode_audio else [],
        },
        "missingEpisodeMedia": missing_episode_media,
        "missingPublicMedia": missing_public_media,
    }
    payloads = {
        "env": env_values,
        "pages": pages,
        "posts": posts,
        "episodes": episodes,
        "people": people,
        "endorsements": endorsements,
        "media": media_records,
        "redirects": redirects,
        "planFingerprint": plan_fingerprint,
    }
    return plan, payloads


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.apply and not (args.verify_media and args.verify_episode_audio and args.copy_media):
            raise ValueError("--apply requires --verify-media --verify-episode-audio --copy-media")
        plan, payloads = build_plan(args)
        if args.plan_output:
            write_json(args.plan_output, plan)
        if args.redirect_output:
            write_json(args.redirect_output, payloads["redirects"])
        if args.media_output:
            write_json(args.media_output, [media_manifest_entry(record) for record in payloads["media"] if record.visibility == "public" and record.exists])
        if args.apply:
            plan["applyResults"] = apply_plan(
                args,
                payloads["env"],
                payloads["pages"],
                payloads["posts"],
                payloads["episodes"],
                payloads["people"],
                payloads["endorsements"],
                payloads["media"],
                payloads["redirects"],
                payloads["planFingerprint"],
            )
            if args.plan_output:
                write_json(args.plan_output, plan)
        print(json.dumps(plan, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except Exception as error:
        print(f"pastorwood cutover failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
