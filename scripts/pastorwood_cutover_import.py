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
import tempfile
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Sequence

import psycopg

try:
    from scripts.aic_database_env import CANONICAL_AIC_ENV, database_dsn, load_canonical_aic_env
except ModuleNotFoundError:  # Direct execution from /mnt/storage/aic/scripts.
    from aic_database_env import CANONICAL_AIC_ENV, database_dsn, load_canonical_aic_env


LEGACY_ORIGIN = "https://www.pastorwood.org"
DEFAULT_MIGRATION_ROOT = Path("/mnt/storage/pastorwood-migration-20260722")
DEFAULT_WORDPRESS_SNAPSHOT = DEFAULT_MIGRATION_ROOT / "wordpress-live-snapshot-20260722T145115Z.json"
DEFAULT_REST_MEDIA_BACKUP_MANIFEST = DEFAULT_MIGRATION_ROOT / "wordpress-rest-media-backup-20260722T151500Z.json"
DEFAULT_EXTERNAL_IMAGE_BACKUP_MANIFEST = DEFAULT_MIGRATION_ROOT / "external-image-backup-20260722T152000Z.json"
DEFAULT_CUTOVER_ATTESTATION = DEFAULT_MIGRATION_ROOT / "pastorwood-public-cms-cutover-attestation.json"
DEFAULT_CUTOVER_ATTESTATION_SHA256 = DEFAULT_MIGRATION_ROOT / "pastorwood-public-cms-cutover-attestation.json.sha256"
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
    # /privacy/ belongs to the separate Sermon Search GPT policy surface.
    "privacy": "/privacy-terms-conditions/",
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
    "privacy": "privacy-terms-conditions",
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
PUBLISH_REVIEWED_CONFIRMATION = "PUBLISH_REVIEWED_PASTORWOOD_CUTOVER"
WORDPRESS_REFRESH_CONFIRMATION = "REFRESH_FROM_LIVE_WORDPRESS_DATABASE"
DIRECT_WORDPRESS_REFRESH_TEST_MODE_ENV = "PASTORWOOD_DIRECT_DATABASE_REFRESH_TEST_MODE"
PUBLIC_CACHE_INVALIDATION_URL = "http://127.0.0.1:8087/api/revalidate/strapi"
PUBLIC_CACHE_INVALIDATION_SOURCE = "pastorwood-cutover"
KNOWN_SHORTCODE_PATTERN = re.compile(
    r"\[/?(?:"
    r"et_pb_[A-Za-z0-9_:-]+|vc_[A-Za-z0-9_:-]+|give(?:_[A-Za-z0-9_:-]+)?|"
    r"woocommerce(?:_[A-Za-z0-9_:-]+)?|products?|product_page|cart|checkout|my_account|"
    r"gview|donation_history|wpforms(?:_[A-Za-z0-9_:-]+)?|gravityform|contact-form-7|"
    r"audio|video|caption|gallery|embed"
    r")(?:\s+[^\]]*)?\]",
    re.I,
)
LEGACY_UPLOAD_URL_PATTERN = re.compile(
    r"(?<![A-Za-z0-9._-])(?:(?:https?:)?//(?:www\.)?pastorwood\.org)?"
    r"/wp-content/uploads/[^\s\"'<>]+",
    re.I,
)
LOCAL_LEGACY_MEDIA_PATTERN = re.compile(r"/media/legacy/[^\s\"'<>]+", re.I)
LOCAL_EPISODE_MEDIA_PATTERN = re.compile(r"/media/episodes/[^\s\"'<>]+", re.I)
TRAILING_UPLOAD_PUNCTUATION = ".,;:!?"
TRAILING_UPLOAD_DELIMITERS = {")": "(", "]": "[", "}": "{"}
PUBLIC_EPISODE_TRACK_ID_PATTERN = re.compile(
    r"(?:[0-9]+|sa_[0-9]+|wp-sermon:[0-9]+|cms_[a-z0-9][a-z0-9_-]{0,62})"
)


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


def direct_wordpress_refresh_test_mode() -> bool:
    return (
        os.environ.get("NODE_ENV") == "test"
        and os.environ.get(DIRECT_WORDPRESS_REFRESH_TEST_MODE_ENV) == "1"
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=CANONICAL_AIC_ENV, help="Canonical AIC/Strapi environment file")
    wordpress_sources = ("verified-snapshot",)
    if direct_wordpress_refresh_test_mode():
        wordpress_sources += ("direct-database-refresh",)
    parser.add_argument(
        "--wordpress-source",
        choices=wordpress_sources,
        default="verified-snapshot",
        help="Use only the checksum-pinned verified WordPress snapshot for this release",
    )
    parser.set_defaults(
        confirm_wordpress_refresh="",
        pwood_db_host="",
        pwood_db_port="",
        pwood_db_name="",
        pwood_db_user="",
    )
    if direct_wordpress_refresh_test_mode():
        parser.add_argument(
            "--confirm-wordpress-refresh",
            default="",
            help=f"Non-production test mode only: {WORDPRESS_REFRESH_CONFIRMATION}",
        )
        parser.add_argument("--pwood-db-host", default=os.environ.get("PWOOD_DB_HOST", "127.0.0.1"))
        parser.add_argument("--pwood-db-port", default=os.environ.get("PWOOD_DB_PORT", "5433"))
        parser.add_argument("--pwood-db-name", default=os.environ.get("PWOOD_DB_NAME", "pwood"))
        parser.add_argument("--pwood-db-user", default=os.environ.get("PWOOD_DB_USER", "farmfam"))
    parser.add_argument("--wordpress-rest-snapshot", type=Path, default=DEFAULT_WORDPRESS_SNAPSHOT, help="Required two-pass immutable WordPress snapshot")
    parser.add_argument("--wordpress-rest-checksum", type=Path, help="Snapshot SHA-256 file (defaults to <snapshot>.sha256)")
    parser.add_argument("--rest-media-backup-manifest", type=Path, default=DEFAULT_REST_MEDIA_BACKUP_MANIFEST, help="SHA-256 manifest for the verified snapshot media increment")
    parser.add_argument("--external-image-backup-manifest", type=Path, default=DEFAULT_EXTERNAL_IMAGE_BACKUP_MANIFEST, help="SHA-256 manifest for every allowlisted external legacy image")
    parser.add_argument("--legacy-urls", type=Path, default=DEFAULT_MIGRATION_ROOT / "legacy-public-urls.txt")
    parser.add_argument("--attachment-manifest", type=Path, default=DEFAULT_MIGRATION_ROOT / "wordpress-attachment-urls.txt")
    parser.add_argument("--restricted-media-root", type=Path, default=DEFAULT_RESTRICTED_MEDIA_ROOT)
    parser.add_argument("--public-media-root", type=Path, default=DEFAULT_PUBLIC_MEDIA_ROOT)
    parser.add_argument("--plan-output", type=Path)
    parser.add_argument("--redirect-output", type=Path)
    parser.add_argument("--media-output", type=Path)
    parser.add_argument(
        "--reviewed-media-dispositions",
        type=Path,
        default=Path("ops/cutover/pastorwood-reviewed-media-dispositions.json"),
        help="Optional snapshot-bound, committed approvals for removing unavailable published media references",
    )
    parser.add_argument("--checkpoint", type=Path, default=Path(".migration-state/pastorwood-cutover-checkpoint.json"))
    parser.add_argument("--mutation-manifest", type=Path, default=Path(".migration-state/pastorwood-cutover-mutations.json"))
    parser.add_argument("--publication-manifest", type=Path, default=Path(".migration-state/pastorwood-cutover-publications.json"))
    parser.add_argument("--failure-report", type=Path, default=Path(".migration-state/pastorwood-cutover-failures.json"))
    parser.add_argument("--apply", action="store_true", help="Write to Strapi and the distinct public media root")
    parser.add_argument("--confirm", default="", help=f"Required with --apply: {APPLY_CONFIRMATION}")
    parser.add_argument("--publish-reviewed", action="store_true", help="Separate phase 2: publish only reviewed eligible drafts and activate redirects last")
    parser.add_argument(
        "--confirm-publish-reviewed",
        default="",
        help=f"Required with --publish-reviewed: {PUBLISH_REVIEWED_CONFIRMATION}",
    )
    parser.add_argument(
        "--reviewed-mutation-manifest-sha256",
        default="",
        help="Exact phase-one mutation manifest SHA-256 independently reviewed before phase-two publication",
    )
    parser.add_argument("--verify-media", action="store_true", help="Stat every explicitly allowlisted source path")
    parser.add_argument("--verify-episode-audio", action="store_true", help="Read MinIO object names and reconcile all AIC track IDs")
    parser.add_argument("--mc-bin", default=os.environ.get("AIC_AUDIO_MC_BIN", "/usr/local/bin/mc"))
    parser.add_argument("--mc-audio-target", default=os.environ.get("AIC_AUDIO_MC_TARGET", "local-minio/aic/podcasts"))
    parser.add_argument("--copy-media", action="store_true", help="Copy/checksum public allowlisted media while applying")
    parser.add_argument("--no-resume", action="store_true", help="Ignore (but do not delete) a prior checkpoint")
    return parser.parse_args(argv)


def validate_identifier(value: str, label: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", value):
        raise ValueError(f"Unsafe {label} value")
    return value


def json_rows(value: Any) -> list[dict[str, Any]]:
    parsed = json.loads(value) if isinstance(value, str) else value
    if not isinstance(parsed, list):
        raise RuntimeError("source query did not return a JSON array")
    return [item for item in parsed if isinstance(item, dict)]


def fetch_wordpress_direct_refresh(args: argparse.Namespace) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not direct_wordpress_refresh_test_mode():
        raise RuntimeError(
            "Direct WordPress database refresh is unavailable outside explicit non-production test mode."
        )
    if args.wordpress_source != "direct-database-refresh" or args.confirm_wordpress_refresh != WORDPRESS_REFRESH_CONFIRMATION:
        raise RuntimeError(
            "Direct WordPress database test refresh requires its exact source mode and confirmation."
        )
    host = str(args.pwood_db_host).strip()
    port = str(args.pwood_db_port).strip()
    database = validate_identifier(args.pwood_db_name, "database")
    user = validate_identifier(args.pwood_db_user, "database user")
    password = os.environ.get("PWOOD_DB_PASSWORD", "")
    if not host or not port.isdigit() or not password:
        raise RuntimeError("Direct WordPress source settings require PWOOD_DB_HOST, PWOOD_DB_PORT, and PWOOD_DB_PASSWORD.")
    with psycopg.connect(
        host=host,
        port=int(port),
        dbname=database,
        user=user,
        password=password,
        connect_timeout=5,
        application_name="pastorwood-cutover-wordpress-read",
    ) as connection:
        connection.execute("set transaction isolation level repeatable read read only")
        content = json_rows(connection.execute(WP_CONTENT_SQL).fetchone()[0])
        attachments = json_rows(connection.execute(WP_ATTACHMENTS_SQL).fetchone()[0])
        return content, attachments


def fetch_aic() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    with psycopg.connect(database_dsn(application_name="pastorwood-cutover-aic-read")) as connection:
        connection.execute("set transaction isolation level repeatable read read only")
        episodes = json_rows(connection.execute(AIC_EPISODES_SQL).fetchone()[0])
        posts = json_rows(connection.execute(AIC_POSTS_SQL).fetchone()[0])
        return episodes, posts


def fetch_episode_audio_inventory(mc_bin: str, target: str) -> dict[str, int]:
    if not re.fullmatch(r"/[A-Za-z0-9._/-]+|[A-Za-z0-9._-]+/[A-Za-z0-9._/-]+", target):
        raise ValueError("Unsafe MinIO audio target")
    result = subprocess.run(
        [mc_bin, "find", "--json", target, "--name", "*.mp3"],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "MinIO episode audio inventory failed")
    inventory: dict[str, int] = {}
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
            name = Path(text(record.get("key"))).name
            size = record.get("size")
        except (json.JSONDecodeError, AttributeError) as error:
            raise RuntimeError(f"Invalid MinIO inventory record: {error}") from error
        if not name.casefold().endswith(".mp3") or not isinstance(size, int) or size < 0:
            raise RuntimeError("Invalid MinIO MP3 inventory metadata")
        object_id = Path(name).stem
        if object_id in inventory:
            raise RuntimeError(f"Duplicate MinIO episode object identity: {object_id}")
        inventory[object_id] = size
    return inventory


def rendered(value: Any) -> str:
    if isinstance(value, dict):
        return text(value.get("rendered"))
    return text(value)


def load_wordpress_rest_snapshot(snapshot_path: Path, checksum_path: Path | None) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    checksum_path = checksum_path or snapshot_path.with_suffix(snapshot_path.suffix + ".sha256")
    try:
        payload = snapshot_path.read_bytes()
        checksum_text = checksum_path.read_text(encoding="ascii").strip()
    except OSError as error:
        raise RuntimeError(f"WordPress REST snapshot/checksum is unavailable: {error}") from error
    digest = hashlib.sha256(payload).hexdigest()
    expected_digest = checksum_text.split()[0] if checksum_text else ""
    if not re.fullmatch(r"[a-f0-9]{64}", expected_digest) or digest != expected_digest:
        raise RuntimeError("WordPress REST snapshot SHA-256 verification failed")
    try:
        snapshot = json.loads(payload)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"WordPress REST snapshot is invalid JSON: {error}") from error
    if not isinstance(snapshot, dict) or snapshot.get("schemaVersion") != 1 or snapshot.get("origin") != LEGACY_ORIGIN:
        raise RuntimeError("WordPress REST snapshot schema or origin is invalid")
    if snapshot.get("consistencyPasses") != 2:
        raise RuntimeError("WordPress REST snapshot is not a two-pass consistent capture")
    collections = snapshot.get("collections")
    totals = snapshot.get("totals")
    if not isinstance(collections, dict) or not isinstance(totals, dict):
        raise RuntimeError("WordPress REST snapshot collections/totals are missing")
    required = {"pages", "posts", "sermons", "media", "categories"}
    if not required.issubset(collections) or not required.issubset(totals):
        raise RuntimeError("WordPress REST snapshot is incomplete")
    inaccessible_media = snapshot.get("inaccessibleMedia", [])
    if not isinstance(inaccessible_media, list) or any(
        not isinstance(row, dict)
        or not isinstance(row.get("id"), int)
        or row.get("httpStatus") != 401
        or row.get("code") != "rest_forbidden"
        for row in inaccessible_media
    ):
        raise RuntimeError("WordPress REST inaccessible-media evidence is invalid")
    inaccessible_media_ids = {row["id"] for row in inaccessible_media}
    if len(inaccessible_media_ids) != len(inaccessible_media):
        raise RuntimeError("WordPress REST inaccessible-media IDs are duplicated")
    for name in required:
        records = collections.get(name)
        total_metadata = totals.get(name)
        if not isinstance(records, list) or any(not isinstance(row, dict) for row in records):
            raise RuntimeError(f"WordPress REST snapshot collection {name} is invalid")
        allowed_inaccessible = len(inaccessible_media_ids) if name == "media" else 0
        if (
            not isinstance(total_metadata, dict)
            or total_metadata.get("total") != len(records) + allowed_inaccessible
            or total_metadata.get("returned") != len(records)
            or total_metadata.get("inaccessible") != allowed_inaccessible
        ):
            raise RuntimeError(f"WordPress REST snapshot total mismatch for {name}")
        ids = [row.get("id") for row in records]
        if any(not isinstance(item_id, int) for item_id in ids) or ids != sorted(ids) or len(ids) != len(set(ids)):
            raise RuntimeError(f"WordPress REST snapshot IDs are invalid for {name}")

    category_slugs = {
        row["id"]: text(row.get("slug"))
        for row in collections["categories"]
        if isinstance(row.get("id"), int) and text(row.get("slug"))
    }
    content_rows: list[dict[str, Any]] = []
    collection_types = {"pages": "page", "posts": "post", "sermons": "wpfc_sermon"}
    for collection_name, expected_type in collection_types.items():
        for row in collections[collection_name]:
            if row.get("status") != "publish" or row.get("type") != expected_type:
                raise RuntimeError(f"WordPress REST {collection_name} contains an unexpected status/type")
            meta: dict[str, Any] = {}
            if expected_type == "wpfc_sermon":
                meta = {
                    "sermon_audio": text(row.get("sermon_audio")),
                    "sermon_date": row.get("sermon_date"),
                    "sermon_description": rendered(row.get("excerpt")),
                    "bible_passage": text(row.get("bible_passage")),
                    "_wpfc_sermon_duration": text(row.get("sermon_audio_duration")),
                    "_thumbnail_id": row.get("featured_media"),
                }
            elif isinstance(row.get("meta"), dict):
                meta = dict(row["meta"])
            categories = [category_slugs[item] for item in row.get("categories", []) if item in category_slugs] if isinstance(row.get("categories"), list) else []
            content_rows.append({
                "id": row["id"],
                "type": expected_type,
                "status": "publish",
                "title": html.unescape(rendered(row.get("title"))),
                "slug": text(row.get("slug")),
                "date": text(row.get("date")),
                "dateGmt": text(row.get("date_gmt")),
                "modified": text(row.get("modified")),
                "modifiedGmt": text(row.get("modified_gmt")),
                "content": rendered(row.get("content")),
                "excerpt": rendered(row.get("excerpt")),
                "parentId": row.get("parent") if isinstance(row.get("parent"), int) else 0,
                "guid": rendered(row.get("guid")) or text(row.get("link")),
                "sourceUrl": text(row.get("link")),
                "categories": categories,
                "meta": meta,
            })

    attachment_rows: list[dict[str, Any]] = []
    for row in collections["media"]:
        if row.get("type") != "attachment":
            raise RuntimeError("WordPress REST media contains a non-attachment record")
        source_url = text(row.get("source_url"))
        relative_path = safe_upload_relative_path(source_url)
        attachment_rows.append({
            "id": row["id"],
            "title": html.unescape(rendered(row.get("title"))),
            "slug": text(row.get("slug")),
            "date": text(row.get("date")),
            "modified": text(row.get("modified")),
            "parentId": row.get("post") if isinstance(row.get("post"), int) else 0,
            "guid": rendered(row.get("guid")) or source_url,
            "sourceUrl": source_url,
            "mimeType": text(row.get("mime_type")),
            "meta": {
                "_wp_attached_file": relative_path or "",
                "_wp_attachment_image_alt": text(row.get("alt_text")),
            },
        })
    evidence = {
        "path": str(snapshot_path),
        "checksumPath": str(checksum_path),
        "sha256": digest,
        "capturedAt": text(snapshot.get("capturedAt")),
        "consistencyPasses": 2,
        "totals": {name: totals[name]["total"] for name in sorted(required)},
        "returnedTotals": {name: totals[name]["returned"] for name in sorted(required)},
        "inaccessibleMedia": inaccessible_media,
    }
    return content_rows, attachment_rows, evidence


def merge_wordpress_sources(
    database_content: Sequence[dict[str, Any]],
    database_attachments: Sequence[dict[str, Any]],
    rest_content: Sequence[dict[str, Any]],
    rest_attachments: Sequence[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    content_by_identity = {(text(row.get("type")), text(row.get("id"))): dict(row) for row in database_content}
    database_content_ids = set(content_by_identity)
    rest_only_content: Counter[str] = Counter()
    rest_only_content_ids: defaultdict[str, list[str]] = defaultdict(list)
    changed_existing_content: defaultdict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rest_content:
        identity = (text(row.get("type")), text(row.get("id")))
        if identity not in database_content_ids:
            rest_only_content[identity[0]] += 1
            rest_only_content_ids[identity[0]].append(identity[1])
            content_by_identity[identity] = dict(row)
            continue
        existing = content_by_identity[identity]
        existing_meta = existing.get("meta") if isinstance(existing.get("meta"), dict) else {}
        rest_meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
        merged = {**existing, **row, "meta": {**existing_meta, **rest_meta}}
        before_fingerprint = stable_fingerprint(existing)
        after_fingerprint = stable_fingerprint(merged)
        if before_fingerprint != after_fingerprint:
            changed_existing_content[identity[0]].append({
                "id": identity[1],
                "beforeFingerprint": before_fingerprint,
                "afterFingerprint": after_fingerprint,
            })
        content_by_identity[identity] = merged

    attachments_by_id = {text(row.get("id")): dict(row) for row in database_attachments}
    database_attachment_ids = set(attachments_by_id)
    rest_only_media_ids: list[str] = []
    changed_existing_media: list[dict[str, str]] = []
    for row in rest_attachments:
        identity = text(row.get("id"))
        if identity not in database_attachment_ids:
            rest_only_media_ids.append(identity)
            attachments_by_id[identity] = dict(row)
            continue
        existing = attachments_by_id[identity]
        existing_meta = existing.get("meta") if isinstance(existing.get("meta"), dict) else {}
        rest_meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
        merged = {**existing, **row, "meta": {**existing_meta, **rest_meta}}
        before_fingerprint = stable_fingerprint(existing)
        after_fingerprint = stable_fingerprint(merged)
        if before_fingerprint != after_fingerprint:
            changed_existing_media.append({
                "id": identity,
                "beforeFingerprint": before_fingerprint,
                "afterFingerprint": after_fingerprint,
            })
        attachments_by_id[identity] = merged

    sort_id = lambda row: int(text(row.get("id"))) if text(row.get("id")).isdigit() else 0
    report = {
        "databaseContent": len(database_content),
        "databaseMedia": len(database_attachments),
        "restOnlyContentCounts": dict(sorted(rest_only_content.items())),
        "restOnlyContentIds": {key: sorted(values, key=int) for key, values in sorted(rest_only_content_ids.items())},
        "restOnlyMediaIds": sorted(rest_only_media_ids, key=int),
        "changedExistingContentCounts": {key: len(values) for key, values in sorted(changed_existing_content.items())},
        "changedExistingContent": {key: sorted(values, key=lambda row: int(row["id"])) for key, values in sorted(changed_existing_content.items())},
        "changedExistingMediaCount": len(changed_existing_media),
        "changedExistingMedia": sorted(changed_existing_media, key=lambda row: int(row["id"])),
        "mergedContent": len(content_by_identity),
        "mergedMedia": len(attachments_by_id),
    }
    return sorted(content_by_identity.values(), key=sort_id), sorted(attachments_by_id.values(), key=sort_id), report


def verify_rest_media_backup_manifest(
    manifest_path: Path | None,
    snapshot_sha256: str,
    expected_media_ids: Sequence[str] | None,
    restricted_media_root: Path,
) -> dict[str, Any]:
    expected_ids = {text(item) for item in expected_media_ids} if expected_media_ids is not None else None
    if manifest_path is None:
        return {
            "enabled": False,
            "manifestPath": "",
            "verifiedFiles": 0,
            "verifiedBytes": 0,
            "missingMediaIds": sorted(expected_ids or set(), key=int),
        }
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"REST media backup manifest is unavailable or invalid: {error}") from error
    if (
        not isinstance(manifest, dict)
        or manifest.get("schemaVersion") != 1
        or manifest.get("snapshotSha256") != snapshot_sha256
        or manifest.get("destinationRoot") != str(DEFAULT_RESTRICTED_MEDIA_ROOT)
    ):
        raise RuntimeError("REST media backup manifest does not match the snapshot/canonical root")
    records = manifest.get("records")
    if not isinstance(records, list) or any(not isinstance(record, dict) for record in records):
        raise RuntimeError("REST media backup manifest records are invalid")
    manifest_ids = [text(record.get("id")) for record in records]
    if any(not item_id.isdigit() for item_id in manifest_ids) or len(manifest_ids) != len(set(manifest_ids)):
        raise RuntimeError("REST media backup manifest IDs are invalid or duplicated")
    if expected_ids is not None and set(manifest_ids) != expected_ids:
        raise RuntimeError("REST media backup manifest does not cover exactly every REST-only media ID")
    verified_bytes = 0
    for record in records:
        relative_path = text(record.get("relativePath"))
        expected_sha256 = text(record.get("sha256"))
        expected_size = record.get("sizeBytes")
        if not re.fullmatch(r"[a-f0-9]{64}", expected_sha256) or not isinstance(expected_size, int) or expected_size < 0:
            raise RuntimeError("REST media backup manifest hash/size evidence is invalid")
        source_path = safe_restricted_media_file(restricted_media_root, relative_path)
        if source_path is None or source_path.stat().st_size != expected_size or file_sha256(source_path) != expected_sha256:
            raise RuntimeError(f"REST media backup verification failed: {relative_path}")
        verified_bytes += expected_size
    if manifest.get("fileCount") != len(records) or manifest.get("totalBytes") != verified_bytes:
        raise RuntimeError("REST media backup manifest aggregate counts are invalid")
    return {
        "enabled": True,
        "manifestPath": str(manifest_path),
        "verifiedFiles": len(records),
        "verifiedBytes": verified_bytes,
        "missingMediaIds": [],
        "verifiedMediaIds": sorted(manifest_ids, key=int),
    }


def text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    return ""


class ExternalImageSourceParser(HTMLParser):
    """Collect image sources without treating arbitrary links as image assets."""

    def __init__(self) -> None:
        super().__init__()
        self.sources: list[str] = []

    def _capture(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.casefold() != "img":
            return
        source = dict(attrs).get("src")
        if source:
            self.sources.append(html.unescape(source))

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._capture(tag, attrs)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._capture(tag, attrs)


def normalize_external_image_url(value: str) -> str | None:
    parsed = urllib.parse.urlsplit(value)
    hostname = (parsed.hostname or "").casefold()
    allowed_host = (
        hostname == "gallery.mailchimp.com"
        or hostname == "mcusercontent.com"
        or hostname.endswith(".mcusercontent.com")
    )
    if parsed.scheme != "https" or not allowed_host or parsed.username or parsed.password or not parsed.path:
        return None
    return urllib.parse.urlunsplit(("https", parsed.netloc, parsed.path, parsed.query, ""))


def extract_external_image_references(wp_content: Sequence[dict[str, Any]]) -> dict[str, set[str]]:
    references: defaultdict[str, set[str]] = defaultdict(set)
    collection_names = {"page": "pages", "post": "posts", "wpfc_sermon": "sermons"}
    for row in wp_content:
        collection = collection_names.get(text(row.get("type")))
        if not collection:
            continue
        parser = ExternalImageSourceParser()
        parser.feed(text(row.get("content")))
        source_identity = f"{collection}:{text(row.get('id'))}"
        for raw_source in parser.sources:
            source_url = normalize_external_image_url(raw_source)
            if source_url:
                references[source_url].add(source_identity)
    return dict(references)


def verify_external_image_backup_manifest(
    manifest_path: Path | None,
    snapshot_sha256: str,
    expected_references: dict[str, set[str]],
    restricted_media_root: Path,
) -> tuple[dict[str, Any], dict[str, str], list[MediaRecord]]:
    expected_urls = set(expected_references)
    if manifest_path is None:
        return ({
            "enabled": False,
            "manifestPath": "",
            "expectedFiles": len(expected_urls),
            "expectedReferences": sum(len(references) for references in expected_references.values()),
            "verifiedFiles": 0,
            "verifiedReferences": 0,
            "verifiedBytes": 0,
            "missingSourceUrls": sorted(expected_urls),
        }, {}, [])
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"External image backup manifest is unavailable or invalid: {error}") from error
    if (
        not isinstance(manifest, dict)
        or manifest.get("schemaVersion") != 1
        or manifest.get("snapshotSha256") != snapshot_sha256
        or manifest.get("destinationRoot") != str(DEFAULT_RESTRICTED_MEDIA_ROOT)
    ):
        raise RuntimeError("External image backup manifest does not match the snapshot/canonical root")
    records = manifest.get("records")
    if not isinstance(records, list) or any(not isinstance(record, dict) for record in records):
        raise RuntimeError("External image backup manifest records are invalid")
    source_urls = [text(record.get("sourceUrl")) for record in records]
    if len(source_urls) != len(set(source_urls)) or set(source_urls) != expected_urls:
        raise RuntimeError("External image backup manifest does not cover exactly every referenced external image")

    public_paths: dict[str, str] = {}
    media_records: list[MediaRecord] = []
    relative_paths: set[str] = set()
    verified_bytes = 0
    verified_references = 0
    extensions = {"image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp"}
    for record in records:
        source_url = text(record.get("sourceUrl"))
        if normalize_external_image_url(source_url) != source_url:
            raise RuntimeError(f"External image manifest source URL is invalid: {source_url}")
        relative_path = text(record.get("relativePath"))
        public_path = text(record.get("publicPath"))
        content_type = text(record.get("contentType")).casefold()
        expected_sha256 = text(record.get("sha256"))
        expected_size = record.get("sizeBytes")
        references = record.get("references")
        expected_extension = extensions.get(content_type)
        expected_relative_path = (
            f"pastorwood-import/external-images/{hashlib.sha256(source_url.encode('utf-8')).hexdigest()}.{expected_extension}"
            if expected_extension else ""
        )
        if (
            relative_path != expected_relative_path
            or relative_path in relative_paths
            or public_path != f"/media/legacy/{relative_path}"
            or not re.fullmatch(r"[a-f0-9]{64}", expected_sha256)
            or not isinstance(expected_size, int)
            or expected_size < 1
            or not isinstance(references, list)
            or any(not isinstance(reference, str) for reference in references)
            or len(references) != len(set(references))
            or set(references) != expected_references[source_url]
        ):
            raise RuntimeError(f"External image backup manifest metadata is invalid: {source_url}")
        source_path = safe_restricted_media_file(restricted_media_root, relative_path)
        if source_path is None or source_path.stat().st_size != expected_size or file_sha256(source_path) != expected_sha256:
            raise RuntimeError(f"External image backup verification failed: {relative_path}")
        relative_paths.add(relative_path)
        public_paths[source_url] = public_path
        verified_bytes += expected_size
        verified_references += len(references)
        media_records.append(MediaRecord(
            attachment_id=f"external-{hashlib.sha256(source_url.encode('utf-8')).hexdigest()[:20]}",
            title=source_path.name,
            relative_path=relative_path,
            source_url=source_url,
            mime_type=content_type,
            visibility="public",
            referenced_by=tuple(sorted(references)),
            exists=True,
            size_bytes=expected_size,
        ))
    if (
        manifest.get("fileCount") != len(records)
        or manifest.get("referenceCount") != verified_references
        or manifest.get("totalBytes") != verified_bytes
    ):
        raise RuntimeError("External image backup manifest aggregate counts are invalid")
    evidence = {
        "enabled": True,
        "manifestPath": str(manifest_path),
        "expectedFiles": len(expected_urls),
        "expectedReferences": sum(len(references) for references in expected_references.values()),
        "verifiedFiles": len(records),
        "verifiedReferences": verified_references,
        "verifiedBytes": verified_bytes,
        "missingSourceUrls": [],
    }
    return evidence, public_paths, sorted(media_records, key=lambda record: record.relative_path)


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


def public_episode_media_url(track_id: str) -> str:
    if len(track_id) > 100 or not PUBLIC_EPISODE_TRACK_ID_PATTERN.fullmatch(track_id):
        return ""
    return f"/media/episodes/{urllib.parse.quote(track_id, safe='')}"


def public_episode_track_id_from_url(value: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(value)
    except ValueError:
        return ""
    prefix = "/media/episodes/"
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment or not parsed.path.startswith(prefix):
        return ""
    encoded_track_id = parsed.path.removeprefix(prefix)
    if not encoded_track_id or "/" in encoded_track_id or "\\" in encoded_track_id:
        return ""
    track_id = urllib.parse.unquote(encoded_track_id)
    if (
        "/" in track_id
        or "\\" in track_id
        or re.search(r"%[0-9a-fA-F]{2}", track_id)
        or len(track_id) > 100
        or not PUBLIC_EPISODE_TRACK_ID_PATTERN.fullmatch(track_id)
    ):
        return ""
    return track_id


def normalize_public_episode_url_match(value: str) -> tuple[str, str]:
    candidate = value
    trailing = ""
    while candidate:
        final = candidate[-1]
        if final in TRAILING_UPLOAD_PUNCTUATION:
            trailing = final + trailing
            candidate = candidate[:-1]
            continue
        opener = TRAILING_UPLOAD_DELIMITERS.get(final)
        if opener and candidate.count(final) > candidate.count(opener):
            trailing = final + trailing
            candidate = candidate[:-1]
            continue
        break
    return public_episode_track_id_from_url(candidate), trailing


def stable_fingerprint(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def strip_markup(value: str) -> str:
    without_shortcodes = KNOWN_SHORTCODE_PATTERN.sub(" ", value)
    without_tags = re.sub(r"<[^>]+>", " ", without_shortcodes)
    return re.sub(r"\s+", " ", html.unescape(without_tags)).strip()


def localize_legacy_upload_urls(value: str) -> str:
    def local_upload(match: re.Match[str]) -> str:
        relative, trailing = normalize_legacy_upload_reference(match.group(0))
        inside_tag = match.string.rfind("<", 0, match.start()) > match.string.rfind(">", 0, match.start())
        if inside_tag:
            trailing = ""
        return f"/media/legacy/{relative}{trailing}" if relative else match.group(0)

    return LEGACY_UPLOAD_URL_PATTERN.sub(local_upload, value)


def clean_legacy_content(value: str, external_image_paths: dict[str, str] | None = None) -> str:
    """Remove WordPress/Divi wrappers while retaining authored HTML and inner copy."""
    cleaned = re.sub(r"<!--(?:.|\n)*?-->", "", value)
    cleaned = re.sub(r"<\?(?:php)?(?:.|\n)*?\?>", "", cleaned, flags=re.I)
    cleaned = re.sub(r"<(script|style|object|embed|form)\b[^>]*>(?:.|\n)*?</\1\s*>", "", cleaned, flags=re.I)
    cleaned = re.sub(r"<(?:script|style|object|embed|form)\b[^>]*/?>", "", cleaned, flags=re.I)
    cleaned = KNOWN_SHORTCODE_PATTERN.sub("", cleaned)
    cleaned = re.sub(r"\s+on[A-Za-z]+\s*=\s*(?:\"[^\"]*\"|'[^']*')", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s+(?:href|src)\s*=\s*([\"'])\s*javascript:[^\"']*\1", "", cleaned, flags=re.I)
    cleaned = localize_legacy_upload_urls(cleaned)
    for source_url, public_path in sorted((external_image_paths or {}).items(), key=lambda item: (-len(item[0]), item[0])):
        cleaned = cleaned.replace(source_url, public_path)
        cleaned = cleaned.replace(html.escape(source_url, quote=True), public_path)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def safe_upload_relative_path(value: str) -> str | None:
    source = html.unescape(value).strip()
    if not source or any(character in "\"'<>" or ord(character) < 32 or ord(character) == 127 for character in source):
        return None

    parse_value = f"https:{source}" if source.startswith("//") else source
    try:
        parsed = urllib.parse.urlsplit(parse_value)
        parsed_port = parsed.port
    except ValueError:
        return None
    absolute_source = bool(parsed.scheme or parsed.netloc)
    if absolute_source:
        if (
            parsed.scheme not in {"http", "https"}
            or (parsed.hostname or "").casefold() not in {"pastorwood.org", "www.pastorwood.org"}
            or parsed.username
            or parsed.password
            or parsed_port not in {None, 80, 443}
        ):
            return None
    encoded_path = parsed.path
    for _iteration in range(4):
        # Encoded URL delimiters must not be reinterpreted as filesystem path
        # structure or silently truncate a filename after URL parsing.
        if re.search(r"%(?:2f|5c|3f|23)", encoded_path, re.I):
            return None
        decoded_path = urllib.parse.unquote(encoded_path)
        if decoded_path == encoded_path:
            break
        encoded_path = decoded_path
    else:
        return None
    if (
        re.search(r"%[0-9a-fA-F]{2}", encoded_path)
        or any(character in "\\?#\"'<>" or ord(character) < 32 or ord(character) == 127 for character in encoded_path)
    ):
        return None
    raw = encoded_path

    marker = "/wp-content/uploads/"
    marker_index = raw.casefold().find(marker)
    if absolute_source and marker_index < 0:
        return None
    if marker_index >= 0:
        raw = raw[marker_index + len(marker):]
    raw = raw.lstrip("/")
    if not raw or "//" in raw or any(raw.endswith(close) and raw.count(close) > raw.count(open_) for close, open_ in TRAILING_UPLOAD_DELIMITERS.items()):
        return None
    raw_parts = raw.split("/")
    if any(part in {"", ".", ".."} for part in raw_parts):
        return None
    try:
        path = PurePosixPath(raw)
    except ValueError:
        return None
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        return None
    if any(part.casefold() in PRIVATE_MEDIA_SEGMENTS for part in path.parts):
        return None
    if any(ord(character) < 32 for character in raw):
        return None
    return path.as_posix()


def normalize_legacy_upload_reference(value: str) -> tuple[str | None, str]:
    """Split prose/markup punctuation from a legacy upload and normalize its path."""
    candidate = value
    trailing = ""
    while candidate:
        final = candidate[-1]
        if final in TRAILING_UPLOAD_PUNCTUATION:
            trailing = final + trailing
            candidate = candidate[:-1]
            continue
        opener = TRAILING_UPLOAD_DELIMITERS.get(final)
        if opener and candidate.count(final) > candidate.count(opener):
            trailing = final + trailing
            candidate = candidate[:-1]
            continue
        break
    return safe_upload_relative_path(candidate), trailing


def local_legacy_media_url(value: str) -> str:
    source = text(value)
    try:
        parsed = urllib.parse.urlsplit(source)
    except ValueError:
        return ""
    if (
        parsed.scheme not in {"http", "https"}
        or (parsed.hostname or "").casefold() not in {"pastorwood.org", "www.pastorwood.org"}
        or parsed.username
        or parsed.password
        or "/wp-content/uploads/" not in parsed.path
    ):
        return ""
    relative, _trailing = normalize_legacy_upload_reference(source)
    return f"/media/legacy/{relative}" if relative else ""


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


def build_pages(
    wp_content: Sequence[dict[str, Any]],
    external_image_paths: dict[str, str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
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
        body = clean_legacy_content(text(row.get("content")), external_image_paths)
        excerpt = clean_legacy_content(text(row.get("excerpt")), external_image_paths)
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
    external_image_paths: dict[str, str] | None = None,
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
        body = clean_legacy_content(text(row.get("content")), external_image_paths)
        excerpt = clean_legacy_content(text(row.get("excerpt")), external_image_paths)
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

    aic_output_ids: set[str] = set()
    for row in aic_winners:
        legacy_id = text(row.get("postId"))
        aic_output_ids.add(legacy_id)
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
            "summary": text(row.get("summary")) or strip_markup(clean_legacy_content(text(row.get("excerptHtml")), external_image_paths))[:600],
            "body": clean_legacy_content(text(row.get("contentHtml")) or text(row.get("text")), external_image_paths),
            "publishDate": iso_datetime(row.get("publishedAt")) or iso_datetime(row.get("publishDate")),
            "legacyUrl": text(row.get("sourceUrl")),
            "canonicalUrl": f"{LEGACY_ORIGIN}/writings/{slug}/",
            "seo": {
                "title": text(row.get("title")),
                "description": text(row.get("summary"))[:175] or strip_markup(clean_legacy_content(text(row.get("excerptHtml")), external_image_paths))[:175],
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
    if aic_post_reconciliation is not None:
        for record in sorted(posts, key=lambda item: int(text(item.get("legacyId"))) if text(item.get("legacyId")).isdigit() else 0):
            legacy_id = text(record.get("legacyId"))
            if legacy_id in aic_output_ids:
                continue
            aic_post_reconciliation.append({
                "postId": legacy_id,
                "sourceUrl": text(record.get("legacyUrl")),
                "status": "wordpress-only-preserved",
                "matchedBy": "not-present-in-aic",
                "sourceFingerprint": text(record.get("sourceFingerprint")),
            })
    return sorted(posts, key=lambda row: (text(row.get("publishDate")), text(row.get("legacyId"))))


def sermon_audio_relative(sermon: dict[str, Any]) -> str | None:
    meta = sermon.get("meta") if isinstance(sermon.get("meta"), dict) else {}
    return safe_upload_relative_path(text(meta.get("sermon_audio")))


def safe_restricted_media_file(root: Path, relative_path: str) -> Path | None:
    """Resolve a regular, non-symlink file without escaping the configured restricted root."""
    safe_relative = safe_upload_relative_path(relative_path)
    if not safe_relative:
        return None
    try:
        root_resolved = root.resolve(strict=True)
    except (FileNotFoundError, OSError):
        return None
    candidate = root_resolved.joinpath(*PurePosixPath(safe_relative).parts)
    current = root_resolved
    try:
        for part in PurePosixPath(safe_relative).parts:
            current = current / part
            if current.is_symlink():
                return None
        resolved = candidate.resolve(strict=True)
    except (FileNotFoundError, OSError, RuntimeError):
        return None
    if not resolved.is_relative_to(root_resolved) or not resolved.is_file():
        return None
    return resolved


def audio_edge_sha256(path: Path, size_bytes: int, edge_bytes: int = 64 * 1024) -> str:
    digest = hashlib.sha256()
    digest.update(str(size_bytes).encode("ascii"))
    digest.update(b"\0")
    with path.open("rb") as source:
        digest.update(source.read(edge_bytes))
        if size_bytes > edge_bytes:
            source.seek(max(0, size_bytes - edge_bytes))
            digest.update(source.read(edge_bytes))
    return digest.hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_sermon_audio_content_evidence(
    sermons: Sequence[dict[str, Any]],
    matched_wp_ids: set[str],
    restricted_media_root: Path | None,
    enabled: bool,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    report: dict[str, Any] = {
        "enabled": enabled,
        "restrictedRoot": str(restricted_media_root) if restricted_media_root else "",
        "audioReferences": 0,
        "existingPaths": 0,
        "missingOrRejectedPaths": 0,
        "edgeHashedPaths": 0,
        "fullHashedPaths": 0,
        "fullHashedBytes": 0,
    }
    if not enabled or restricted_media_root is None:
        return {}, report

    path_rows: defaultdict[str, list[str]] = defaultdict(list)
    evidence: dict[str, dict[str, Any]] = {}
    missing_or_rejected: set[str] = set()
    for sermon in sermons:
        wp_id = text(sermon.get("id"))
        relative_path = sermon_audio_relative(sermon)
        if not wp_id or not relative_path:
            continue
        report["audioReferences"] += 1
        path = safe_restricted_media_file(restricted_media_root, relative_path)
        if path is None:
            missing_or_rejected.add(relative_path)
            continue
        path_rows[relative_path].append(wp_id)
        evidence[wp_id] = {
            "relativePath": relative_path,
            "sizeBytes": path.stat().st_size,
        }

    report["existingPaths"] = len(path_rows)
    report["missingOrRejectedPaths"] = len(missing_or_rejected)
    size_groups: defaultdict[int, list[str]] = defaultdict(list)
    for relative_path, wp_ids in path_rows.items():
        size_groups[int(evidence[wp_ids[0]]["sizeBytes"])].append(relative_path)

    edge_groups: defaultdict[tuple[int, str], list[str]] = defaultdict(list)
    edge_hashed_paths: set[str] = set()
    for size_bytes, relative_paths in size_groups.items():
        if len(relative_paths) < 2:
            continue
        if not any(wp_id not in matched_wp_ids for relative_path in relative_paths for wp_id in path_rows[relative_path]):
            continue
        for relative_path in relative_paths:
            path = safe_restricted_media_file(restricted_media_root, relative_path)
            if path is None:
                continue
            edge_sha256 = audio_edge_sha256(path, size_bytes)
            edge_groups[(size_bytes, edge_sha256)].append(relative_path)
            edge_hashed_paths.add(relative_path)
            for wp_id in path_rows[relative_path]:
                evidence[wp_id]["edgeSha256"] = edge_sha256

    full_hash_cache: dict[str, str] = {}
    for (_size_bytes, _edge_sha256), relative_paths in edge_groups.items():
        if len(relative_paths) < 2:
            continue
        if not any(wp_id not in matched_wp_ids for relative_path in relative_paths for wp_id in path_rows[relative_path]):
            continue
        for relative_path in relative_paths:
            path = safe_restricted_media_file(restricted_media_root, relative_path)
            if path is None:
                continue
            content_sha256 = full_hash_cache.setdefault(relative_path, file_sha256(path))
            for wp_id in path_rows[relative_path]:
                evidence[wp_id]["contentSha256"] = content_sha256

    report["edgeHashedPaths"] = len(edge_hashed_paths)
    report["fullHashedPaths"] = len(full_hash_cache)
    report["fullHashedBytes"] = sum(
        int(evidence[path_rows[relative_path][0]]["sizeBytes"])
        for relative_path in full_hash_cache
    )
    return evidence, report


def build_episodes(
    wp_content: Sequence[dict[str, Any]],
    aic_episodes: Sequence[dict[str, Any]],
    reconciliation: list[dict[str, str]] | None = None,
    restricted_media_root: Path | None = None,
    verify_audio_content: bool = False,
    audio_deduplication_report: dict[str, Any] | None = None,
    baseline_wp_content: Sequence[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[EpisodeMatch]]:
    sermons = [row for row in wp_content if text(row.get("type")) == "wpfc_sermon"]
    sermons_by_id = {text(row.get("id")): row for row in sermons}
    baseline_sermons = [row for row in (baseline_wp_content or []) if text(row.get("type")) == "wpfc_sermon"]
    baseline_wp_ids = {text(row.get("id")) for row in baseline_sermons}
    if baseline_sermons:
        preserved_matches = [match for match in match_episodes(aic_episodes, baseline_sermons) if match.wp_sermon_id in sermons_by_id]
        preserved_track_ids = {match.aic_track_id for match in preserved_matches}
        remaining_aic = [row for row in aic_episodes if text(row.get("trackId")) not in preserved_track_ids]
        rest_only_sermons = [row for row in sermons if text(row.get("id")) not in baseline_wp_ids]
        matches = sorted([*preserved_matches, *match_episodes(remaining_aic, rest_only_sermons)], key=lambda match: match.aic_track_id)
    else:
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
            "externalAudioUrl": public_episode_media_url(track_id),
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
    audio_content_evidence, audio_content_report = build_sermon_audio_content_evidence(
        sermons,
        matched_wp_ids,
        restricted_media_root,
        verify_audio_content,
    )
    if audio_deduplication_report is not None:
        audio_deduplication_report.update(audio_content_report)
    aic_audio: defaultdict[str, list[str]] = defaultdict(list)
    aic_title_date: defaultdict[tuple[str, str], list[str]] = defaultdict(list)
    aic_title_only: defaultdict[str, list[tuple[str, str]]] = defaultdict(list)
    for row in aic_episodes:
        track_id = text(row.get("trackId"))
        audio_key = basename_key(text(row.get("sourceFile")))
        if audio_key:
            aic_audio[audio_key].append(track_id)
        title_date = (canonical_episode_title(text(row.get("title"))), iso_date(row.get("publishDate")))
        if all(title_date):
            aic_title_date[title_date].append(track_id)
        if title_date[0]:
            aic_title_only[title_date[0]].append((track_id, title_date[1]))

    matched_audio_paths: defaultdict[str, list[EpisodeMatch]] = defaultdict(list)
    matched_content_hashes: defaultdict[str, list[EpisodeMatch]] = defaultdict(list)
    for match in matches:
        matched_sermon = sermons_by_id[match.wp_sermon_id]
        matched_relative_audio = sermon_audio_relative(matched_sermon)
        if matched_relative_audio:
            matched_audio_paths[matched_relative_audio].append(match)
        matched_content_sha256 = text(audio_content_evidence.get(match.wp_sermon_id, {}).get("contentSha256"))
        if matched_content_sha256:
            matched_content_hashes[matched_content_sha256].append(match)

    seen_wp_evidence: dict[tuple[str, ...], str] = {}
    seen_wp_content_hashes: dict[str, str] = {}
    for sermon in sorted(sermons, key=lambda row: int(text(row.get("id"))) if text(row.get("id")).isdigit() else 0):
        wp_id = text(sermon.get("id"))
        if wp_id in matched_wp_ids:
            continue
        relative_audio = sermon_audio_relative(sermon)
        audio_key = basename_key(relative_audio or "")
        title_key = canonical_episode_title(text(sermon.get("title")))
        program_date = wordpress_sermon_date(sermon)
        audio_evidence = audio_content_evidence.get(wp_id, {})
        content_sha256 = text(audio_evidence.get("contentSha256"))
        evidence_fingerprint = stable_fingerprint({
            "audio": relative_audio or "",
            "audioContentSha256": content_sha256,
            "audioSizeBytes": audio_evidence.get("sizeBytes"),
            "title": title_key,
            "date": program_date,
        })
        duplicate_matches = matched_audio_paths.get(relative_audio or "", []) if relative_audio else []
        duplicate_reason = "aic-audio-path" if duplicate_matches else ""
        if not duplicate_matches and content_sha256:
            duplicate_matches = matched_content_hashes.get(content_sha256, [])
            duplicate_reason = "aic-audio-content-sha256" if duplicate_matches else ""
        if duplicate_matches:
            canonical_match = sorted(duplicate_matches, key=lambda item: (item.aic_track_id, item.wp_sermon_id))[0]
            if reconciliation is not None:
                reconciliation.append({
                    "wpSermonId": wp_id,
                    "status": "duplicate-aic",
                    "reason": duplicate_reason,
                    "canonicalTrackId": canonical_match.aic_track_id,
                    "canonicalWpSermonId": canonical_match.wp_sermon_id,
                    "audioContentSha256": content_sha256,
                    "evidenceFingerprint": evidence_fingerprint,
                })
            continue
        explicit_bestof_replay = (
            wp_id not in baseline_wp_ids
            and bool(relative_audio)
            and bool(re.search(r"(?:^|[-_])best[-_]?of(?:[-_]|$)|bestof", PurePosixPath(relative_audio or "").name, re.I))
        )
        if explicit_bestof_replay and title_key:
            replay_candidates = aic_title_only.get(title_key, [])
            if replay_candidates:
                prior_candidates = [item for item in replay_candidates if item[1] and item[1] <= program_date]
                canonical_track_id = sorted(prior_candidates or replay_candidates, key=lambda item: (item[1], item[0]))[-1][0]
                if reconciliation is not None:
                    reconciliation.append({
                        "wpSermonId": wp_id,
                        "status": "duplicate-aic",
                        "reason": "explicit-bestof-canonical-title",
                        "canonicalTrackId": canonical_track_id,
                        "audioContentSha256": content_sha256,
                        "evidenceFingerprint": evidence_fingerprint,
                    })
                continue
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
                    "audioContentSha256": content_sha256,
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
                    "audioContentSha256": content_sha256,
                    "evidenceFingerprint": evidence_fingerprint,
                })
            continue
        content_representative = seen_wp_content_hashes.get(content_sha256) if content_sha256 else None
        if content_representative:
            if reconciliation is not None:
                reconciliation.append({
                    "wpSermonId": wp_id,
                    "status": "duplicate-wordpress",
                    "reason": "audio-content-sha256",
                    "canonicalWpSermonId": content_representative,
                    "audioContentSha256": content_sha256,
                    "evidenceFingerprint": evidence_fingerprint,
                })
            continue
        seen_wp_evidence[wp_key] = wp_id
        if content_sha256:
            seen_wp_content_hashes[content_sha256] = wp_id
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
                "audioContentSha256": content_sha256,
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
        if not audio_url:
            missing.append({
                "trackId": text(episode.get("trackId")),
                "relativePath": "",
                "reason": "no-verified-public-audio",
            })
            episode["archiveReason"] = "CUTOVER_METADATA_ONLY: no verified public audio; publication is blocked until validated."
            episode["sourceFingerprint"] = ""
            episode["sourceFingerprint"] = stable_fingerprint(episode)
            continue
        if not audio_url.startswith("/media/legacy/"):
            continue
        relative = audio_url.removeprefix("/media/legacy/")
        if relative not in verified:
            missing.append({"trackId": text(episode.get("trackId")), "relativePath": relative, "reason": "not-in-verified-public-manifest"})
            episode["externalAudioUrl"] = ""
            episode["archiveReason"] = "CUTOVER_METADATA_ONLY: no verified public audio; publication is blocked until validated."
        episode["sourceFingerprint"] = ""
        episode["sourceFingerprint"] = stable_fingerprint(episode)
    return missing


def shortcode_attributes(value: str) -> dict[str, str]:
    return {
        key: html.unescape(attribute_value).strip()
        for key, attribute_value in re.findall(r'([A-Za-z0-9_:-]+)="([^"]*)"', value)
    }


class DiviStructuredContentParser(HTMLParser):
    """Extract board members and testimonials from WordPress-rendered Divi HTML."""

    VOID_TAGS = {
        "area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr",
    }
    BLOCK_TAGS = {"article", "blockquote", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "p", "section"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[dict[str, Any]] = []
        self.people: list[dict[str, str]] = []
        self.testimonials: list[dict[str, str]] = []
        self.standalone_images: list[dict[str, str]] = []
        self.current_person: dict[str, Any] | None = None
        self.current_testimonial: dict[str, Any] | None = None

    @staticmethod
    def _classes(attributes: dict[str, str]) -> set[str]:
        return {item for item in attributes.get("class", "").split() if item}

    def _inside(self, class_name: str) -> bool:
        return any(class_name in frame["classes"] for frame in self.stack)

    @staticmethod
    def _joined(parts: Sequence[str]) -> str:
        return re.sub(r"\s+", " ", "".join(parts)).strip()

    def _finish_frame(self, frame: dict[str, Any]) -> None:
        if frame.get("finished"):
            return
        module = frame.get("module")
        if module == "person" and isinstance(frame.get("record"), dict):
            person = frame["record"]
            frame["finished"] = True
            if self.current_person is person:
                self.current_person = None
            record = {
                "name": self._joined(person["name"]),
                "position": self._joined(person["position"]),
                "biography": self._joined(person["biography"]),
                "imageUrl": text(person.get("imageUrl")),
                "website": text(person.get("website")),
            }
            self.people.append(record)
        elif module == "testimonial" and isinstance(frame.get("record"), dict):
            testimonial = frame["record"]
            frame["finished"] = True
            if self.current_testimonial is testimonial:
                self.current_testimonial = None
            record = {
                "quote": self._joined(testimonial["quote"]).strip(" \u201c\"\u201d"),
                "attribution": self._joined(testimonial["attribution"]),
                "title": self._joined(testimonial["title"]),
                "organization": self._joined(testimonial["organization"]),
                "documentUrl": text(testimonial.get("documentUrl")),
            }
            self.testimonials.append(record)

    def _start(self, tag: str, attrs: list[tuple[str, str | None]], *, push: bool) -> None:
        tag = tag.casefold()
        attributes = {key.casefold(): html.unescape(value or "") for key, value in attrs}
        classes = self._classes(attributes)
        frame: dict[str, Any] = {"tag": tag, "classes": classes}

        if tag == "div" and "et_pb_module" in classes and "et_pb_team_member" in classes:
            if self.current_person is not None:
                for existing in reversed(self.stack):
                    if existing.get("module") == "person":
                        self._finish_frame(existing)
                        break
            self.current_person = {"name": [], "position": [], "biography": [], "imageUrl": "", "website": ""}
            frame["module"] = "person"
            frame["record"] = self.current_person
        elif tag == "div" and "et_pb_module" in classes and "et_pb_testimonial" in classes:
            if self.current_testimonial is not None:
                for existing in reversed(self.stack):
                    if existing.get("module") == "testimonial":
                        self._finish_frame(existing)
                        break
            self.current_testimonial = {
                "quote": [], "attribution": [], "title": [], "organization": [], "documentUrl": "",
            }
            frame["module"] = "testimonial"
            frame["record"] = self.current_testimonial

        if self.current_person is not None:
            if tag == "img" and self._inside("et_pb_team_member_image") and not self.current_person["imageUrl"]:
                self.current_person["imageUrl"] = attributes.get("src", "")
            elif tag == "a" and not self.current_person["website"]:
                href = attributes.get("href", "")
                if href.startswith(("https://", "http://")):
                    self.current_person["website"] = href

        if tag == "img" and self._inside("et_pb_image") and attributes.get("src"):
            self.standalone_images.append({
                "src": attributes["src"],
                "label": attributes.get("alt") or attributes.get("title", ""),
            })

        if self.current_testimonial is not None and tag == "iframe" and self._inside("et_pb_testimonial_content"):
            self.current_testimonial["documentUrl"] = attributes.get("src", "")

        if tag == "br" or tag in self.BLOCK_TAGS:
            self._capture_data(" ")

        if push:
            self.stack.append(frame)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._start(tag, attrs, push=tag.casefold() not in self.VOID_TAGS)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._start(tag, attrs, push=False)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.casefold()
        if tag in self.BLOCK_TAGS:
            self._capture_data(" ")
        matching_index = next((index for index in range(len(self.stack) - 1, -1, -1) if self.stack[index]["tag"] == tag), None)
        if matching_index is None:
            return
        removed = self.stack[matching_index:]
        del self.stack[matching_index:]
        for frame in reversed(removed):
            self._finish_frame(frame)

    def _capture_data(self, value: str) -> None:
        if self.current_person is not None:
            if self._inside("et_pb_module_header"):
                self.current_person["name"].append(value)
            elif self._inside("et_pb_member_position"):
                self.current_person["position"].append(value)
            elif self._inside("et_pb_team_member_description"):
                self.current_person["biography"].append(value)
        if self.current_testimonial is not None:
            if self._inside("et_pb_testimonial_content"):
                self.current_testimonial["quote"].append(value)
            elif self._inside("et_pb_testimonial_author"):
                self.current_testimonial["attribution"].append(value)
            elif self._inside("et_pb_testimonial_position"):
                self.current_testimonial["title"].append(value)
            elif self._inside("et_pb_testimonial_company"):
                self.current_testimonial["organization"].append(value)

    def handle_data(self, data: str) -> None:
        self._capture_data(data)

    def finish(self) -> None:
        for frame in reversed(self.stack):
            self._finish_frame(frame)
        self.stack.clear()


def divi_rendered_structured_content(value: str) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    parser = DiviStructuredContentParser()
    parser.feed(value)
    parser.close()
    parser.finish()
    normalized_people = [(person, normalize_title(person["name"])) for person in parser.people]
    for image_record in parser.standalone_images:
        label = normalize_title(image_record["label"])
        if len(label) < 3:
            continue
        matches = [person for person, name in normalized_people if name == label or name.startswith(f"{label} ")]
        if len(matches) == 1 and not matches[0]["imageUrl"]:
            matches[0]["imageUrl"] = image_record["src"]
    return parser.people, parser.testimonials


def testimonial_document_url(value: str) -> str:
    source = html.unescape(value).strip()
    if source.startswith("//"):
        source = f"https:{source}"
    try:
        parsed = urllib.parse.urlsplit(source)
        if (parsed.hostname or "").casefold() == "docs.google.com":
            embedded = urllib.parse.parse_qs(parsed.query).get("url", [])
            if embedded:
                return embedded[0]
    except ValueError:
        return source
    return source


def build_people_and_endorsements(
    wp_content: Sequence[dict[str, Any]],
    excluded_endorsements: list[dict[str, str]] | None = None,
    structured_coverage: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    people: list[dict[str, Any]] = []
    endorsements: list[dict[str, Any]] = []
    people_coverage: list[dict[str, str]] = []
    endorsement_coverage: list[dict[str, str]] = []
    seen_people: set[str] = set()
    seen_endorsements: set[tuple[str, str]] = set()
    team_pattern = re.compile(r"\[et_pb_team_member\s+([^\]]*)\](.*?)\[/et_pb_team_member\]", re.I | re.S)
    testimonial_pattern = re.compile(r"\[et_pb_testimonial\s+([^\]]*)\](.*?)\[/et_pb_testimonial\]", re.I | re.S)

    def evidence(
        records: list[dict[str, str]],
        legacy_id: str,
        page_id: str,
        page_slug: str,
        source_format: str,
        status: str,
        reason: str,
    ) -> None:
        records.append({
            "legacyId": legacy_id,
            "sourcePageId": page_id,
            "sourcePageSlug": page_slug,
            "sourceFormat": source_format,
            "status": status,
            "reason": reason,
        })

    def add_person(candidate: dict[str, Any], page_id: str, page_slug: str, source_format: str) -> None:
        legacy_id = text(candidate.get("legacyId"))
        name_key = normalize_title(text(candidate.get("name")))
        if not name_key:
            evidence(people_coverage, legacy_id, page_id, page_slug, source_format, "excluded", "missing-name")
            return
        if name_key in seen_people:
            evidence(people_coverage, legacy_id, page_id, page_slug, source_format, "deduplicated", "duplicate-normalized-name")
            return
        seen_people.add(name_key)
        people.append(candidate)
        evidence(people_coverage, legacy_id, page_id, page_slug, source_format, "imported", "")

    def add_endorsement(
        candidate: dict[str, Any],
        page_id: str,
        page_slug: str,
        source_format: str,
        document_url: str = "",
    ) -> None:
        legacy_id = text(candidate.get("legacyId"))
        attribution = text(candidate.get("attribution"))
        quote = text(candidate.get("quote")).strip(" \u201c\"\u201d")
        reason = ""
        if not attribution:
            reason = "missing-attribution"
        elif len(quote) < 20:
            reason = "document-only-no-textual-quote" if document_url else "insufficient-text-no-document"
        if reason:
            evidence(endorsement_coverage, legacy_id, page_id, page_slug, source_format, "excluded", reason)
            if excluded_endorsements is not None:
                excluded_endorsements.append({
                    "legacyId": legacy_id,
                    "attribution": attribution,
                    "documentUrl": document_url,
                    "reason": reason,
                })
            return
        candidate["quote"] = quote
        key = (normalize_title(attribution), normalize_title(quote))
        if key in seen_endorsements:
            evidence(endorsement_coverage, legacy_id, page_id, page_slug, source_format, "deduplicated", "duplicate-attribution-and-quote")
            return
        seen_endorsements.add(key)
        candidate["sortOrder"] = len(endorsements) + 1
        endorsements.append(candidate)
        evidence(endorsement_coverage, legacy_id, page_id, page_slug, source_format, "imported", "")

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
                biography = strip_markup(match.group(2))
                legacy_id = f"wp-page:{page_id}:board:{index}"
                add_person({
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
                    "legacyPhotoUrl": local_legacy_media_url(text(attributes.get("image_url"))),
                }, page_id, page_slug, "divi-shortcode")

            rendered_people, _ = divi_rendered_structured_content(content)
            for index, rendered_person in enumerate(rendered_people, start=1):
                name = text(rendered_person.get("name"))
                add_person({
                    "legacyId": f"wp-page:{page_id}:board-rendered:{index}",
                    "name": name,
                    "slug": slugify(name, f"board-member-{index}"),
                    "title": text(rendered_person.get("position")),
                    "organization": "",
                    "biography": text(rendered_person.get("biography")),
                    "website": text(rendered_person.get("website")),
                    "roles": ["board"],
                    "showOnBoard": True,
                    "sortOrder": index,
                    "active": True,
                    "legacyUrl": f"{LEGACY_ORIGIN}/board-members/",
                    "legacyPhotoUrl": local_legacy_media_url(text(rendered_person.get("imageUrl"))),
                }, page_id, page_slug, "divi-rendered-html")

        for index, match in enumerate(testimonial_pattern.finditer(content), start=1):
            attributes = shortcode_attributes(match.group(1))
            attribution = text(attributes.get("author")) or text(attributes.get("admin_label")).removeprefix("Endorsement:").strip()
            quote = strip_markup(match.group(2)).strip(" “\"”")
            legacy_id = f"wp-page:{page_id}:endorsement:{index}"
            add_endorsement({
                "legacyId": legacy_id,
                "quote": quote,
                "attribution": attribution,
                "title": text(attributes.get("job_title")),
                "organization": text(attributes.get("company_name")),
                "sourceUrl": text(attributes.get("url")) or f"{LEGACY_ORIGIN}/{page_slug}/",
                "sortOrder": 0,
                "featured": page_slug == "abiding-in-christ" and index <= 4,
                "active": True,
            }, page_id, page_slug, "divi-shortcode")

        _, rendered_testimonials = divi_rendered_structured_content(content)
        for index, rendered_testimonial in enumerate(rendered_testimonials, start=1):
            attribution = text(rendered_testimonial.get("attribution"))
            quote = text(rendered_testimonial.get("quote")).strip(" \u201c\"\u201d")
            add_endorsement({
                "legacyId": f"wp-page:{page_id}:endorsement-rendered:{index}",
                "quote": quote,
                "attribution": attribution,
                "title": text(rendered_testimonial.get("title")),
                "organization": text(rendered_testimonial.get("organization")),
                "sourceUrl": f"{LEGACY_ORIGIN}/{page_slug}/",
                "sortOrder": 0,
                "featured": page_slug == "abiding-in-christ" and index <= 4,
                "active": True,
            }, page_id, page_slug, "divi-rendered-html", testimonial_document_url(text(rendered_testimonial.get("documentUrl"))))

    unique_slugs(people, "legacyId")
    if structured_coverage is not None:
        allowed_exclusion_reasons = {"document-only-no-textual-quote"}

        def summary(records: list[dict[str, str]]) -> dict[str, Any]:
            counts = Counter(record["status"] for record in records)
            blocking = [
                record for record in records
                if record["status"] == "excluded" and record["reason"] not in allowed_exclusion_reasons
            ]
            return {
                "encountered": len(records),
                "imported": counts["imported"],
                "deduplicated": counts["deduplicated"],
                "excluded": counts["excluded"],
                "blockingExclusions": blocking,
                "records": records,
            }

        structured_coverage.clear()
        structured_coverage.update({
            "people": summary(people_coverage),
            "endorsements": summary(endorsement_coverage),
        })
    return people, endorsements


def extract_upload_references(
    wp_content: Sequence[dict[str, Any]],
    rejected_references: list[dict[str, str]] | None = None,
) -> defaultdict[str, set[str]]:
    references: defaultdict[str, set[str]] = defaultdict(set)
    rejected_seen: set[tuple[str, str]] = set()

    def reject(source: str, raw_source: str) -> None:
        identity = (source, raw_source)
        if rejected_references is not None and identity not in rejected_seen:
            rejected_seen.add(identity)
            rejected_references.append({
                "source": source,
                "rawSource": raw_source,
                "classification": "unsafe-or-malformed-upload-reference",
            })

    for row in wp_content:
        source_type = text(row.get("type")) or text(row.get("sourceType")) or "aic-post"
        source_id = text(row.get("id")) or text(row.get("postId")) or "unknown"
        source = f"{source_type}:{source_id}"
        fields = [
            text(row.get("content")),
            text(row.get("excerpt")),
            text(row.get("contentHtml")),
            text(row.get("excerptHtml")),
            text(row.get("text")),
            text(row.get("summary")),
        ]
        meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
        fields.extend(text(value) for value in meta.values())
        for field in fields:
            for match in LEGACY_UPLOAD_URL_PATTERN.findall(field):
                relative, _trailing = normalize_legacy_upload_reference(match)
                if relative:
                    references[relative].add(source)
                else:
                    reject(source, match)
        raw_audio = text(meta.get("sermon_audio"))
        audio, _trailing = normalize_legacy_upload_reference(raw_audio)
        if audio:
            references[audio].add(source)
        elif raw_audio and LEGACY_UPLOAD_URL_PATTERN.search(raw_audio):
            reject(source, raw_audio)
    return references


def extract_final_payload_upload_references(
    record_groups: dict[str, Sequence[dict[str, Any]]],
    rejected_references: list[dict[str, str]],
) -> defaultdict[str, set[str]]:
    references: defaultdict[str, set[str]] = defaultdict(set)
    rejected_seen: set[tuple[str, str]] = set()

    def add_or_reject(source: str, raw_source: str, *, local: bool) -> None:
        candidate = raw_source.removeprefix("/media/legacy/") if local else raw_source
        relative_path, _trailing = normalize_legacy_upload_reference(candidate)
        if relative_path:
            references[relative_path].add(source)
            return
        identity = (source, raw_source)
        if identity not in rejected_seen:
            rejected_seen.add(identity)
            rejected_references.append({
                "source": source,
                "rawSource": raw_source,
                "classification": "unsafe-or-malformed-upload-reference",
            })

    def inspect(value: Any, source: str) -> None:
        if isinstance(value, str):
            for match in LEGACY_UPLOAD_URL_PATTERN.findall(value):
                add_or_reject(source, match, local=False)
            for match in LOCAL_LEGACY_MEDIA_PATTERN.findall(value):
                add_or_reject(source, match, local=True)
        elif isinstance(value, list):
            for item in value:
                inspect(item, source)
        elif isinstance(value, dict):
            for item in value.values():
                inspect(item, source)

    identity_fields = ("pageKey", "legacyId", "trackId", "slug")
    for kind, records in record_groups.items():
        for index, record in enumerate(records):
            identity = next((text(record.get(field)) for field in identity_fields if text(record.get(field))), str(index))
            inspect(record, f"{kind}:{identity}")
    return references


def build_raw_media_reference_inventory(
    raw_references: defaultdict[str, set[str]],
    final_references: defaultdict[str, set[str]],
    raw_rejections: Sequence[dict[str, str]],
) -> dict[str, Any]:
    records = [
        {
            "relativePath": relative_path,
            "normalizedSourceUrl": f"{LEGACY_ORIGIN}/wp-content/uploads/{urllib.parse.quote(relative_path, safe='/')}",
            "referencedBy": sorted(referenced_by),
            "classification": "final-public-payload" if relative_path in final_references else "discarded-source-only",
        }
        for relative_path, referenced_by in sorted(raw_references.items())
    ]
    return {
        "encountered": len(records),
        "finalPublicPayload": sum(1 for record in records if record["classification"] == "final-public-payload"),
        "discardedSourceOnly": sum(1 for record in records if record["classification"] == "discarded-source-only"),
        "rejectedRawReferences": list(raw_rejections),
        "records": records,
    }


def localize_final_payload_uploads(record_groups: dict[str, Sequence[dict[str, Any]]]) -> None:
    def rewrite(value: Any) -> Any:
        if isinstance(value, str):
            return localize_legacy_upload_urls(value)
        if isinstance(value, list):
            return [rewrite(item) for item in value]
        if isinstance(value, dict):
            return {key: rewrite(item) for key, item in value.items()}
        return value

    for records in record_groups.values():
        for record in records:
            rewritten = rewrite(record)
            record.clear()
            record.update(rewritten)
            if "sourceFingerprint" in record:
                record["sourceFingerprint"] = ""
                record["sourceFingerprint"] = stable_fingerprint(record)


def read_manifest_urls(path: Path) -> list[str]:
    return [line.strip() for line in path.read_text(encoding="utf-8", errors="replace").splitlines() if line.strip()]


def load_reviewed_media_dispositions(
    path: Path,
    snapshot_sha256: str,
    require_committed: bool,
) -> tuple[dict[str, Any], dict[str, tuple[str, ...]]]:
    if not path.exists():
        return {
            "enabled": False,
            "path": str(path),
            "sha256": "",
            "snapshotSha256": snapshot_sha256,
            "reviewedBy": "",
            "reviewedAt": "",
            "finalPayloadFingerprint": "",
            "records": [],
        }, {}
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("Reviewed media disposition path must be a regular non-symlink file")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Reviewed media disposition file is invalid: {error}") from error
    records = payload.get("dispositions") if isinstance(payload, dict) else None
    reviewed_by = text(payload.get("reviewedBy")) if isinstance(payload, dict) else ""
    reviewed_at = text(payload.get("reviewedAt")) if isinstance(payload, dict) else ""
    payload_fingerprint = text(payload.get("finalPayloadFingerprint")) if isinstance(payload, dict) else ""
    if (
        not isinstance(payload, dict)
        or payload.get("version") != 1
        or text(payload.get("snapshotSha256")) != snapshot_sha256
        or not reviewed_by
        or not reviewed_at
        or not isinstance(records, list)
        or any(not isinstance(record, dict) for record in records)
        or (bool(records) and not re.fullmatch(r"[a-f0-9]{64}", payload_fingerprint))
    ):
        raise RuntimeError("Reviewed media disposition file is not approved for the exact WordPress snapshot")
    try:
        reviewed_datetime = datetime.fromisoformat(reviewed_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise RuntimeError("Reviewed media disposition timestamp is invalid") from error
    if reviewed_datetime.tzinfo is None:
        raise RuntimeError("Reviewed media disposition timestamp must include a timezone")

    approved_removals: dict[str, tuple[str, ...]] = {}
    normalized_records: list[dict[str, Any]] = []
    for record in records:
        relative_path = text(record.get("relativePath"))
        normalized_path = safe_upload_relative_path(relative_path)
        reason = text(record.get("reason"))
        referenced_by = record.get("referencedBy")
        normalized_references = (
            tuple(text(item) for item in referenced_by)
            if isinstance(referenced_by, list) and all(text(item) for item in referenced_by)
            else ()
        )
        if (
            not normalized_path
            or normalized_path != relative_path
            or text(record.get("action")) != "remove-public-reference"
            or len(reason) < 12
            or not normalized_references
            or list(normalized_references) != sorted(set(normalized_references))
            or normalized_path in approved_removals
        ):
            raise RuntimeError("Reviewed media disposition contains an invalid, duplicate, or unexplained removal")
        approved_removals[normalized_path] = normalized_references
        normalized_records.append({
            "relativePath": normalized_path,
            "action": "remove-public-reference",
            "reason": reason,
            "referencedBy": list(normalized_references),
        })

    tracked_at_head = False
    clean_at_head = False
    if require_committed and approved_removals:
        repository_root = Path(__file__).resolve().parent.parent
        resolved_path = path.resolve(strict=True)
        if not resolved_path.is_relative_to(repository_root):
            raise RuntimeError("Reviewed media disposition file must be committed inside the cutover repository")
        repository_relative = resolved_path.relative_to(repository_root).as_posix()
        tracked = subprocess.run(
            ["git", "-C", str(repository_root), "ls-files", "--error-unmatch", "--", repository_relative],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        clean = subprocess.run(
            ["git", "-C", str(repository_root), "diff", "--quiet", "HEAD", "--", repository_relative],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        tracked_at_head = tracked.returncode == 0
        clean_at_head = clean.returncode == 0
        if not tracked_at_head or not clean_at_head:
            raise RuntimeError("Reviewed media dispositions must be tracked and unchanged from the deployed commit")

    return {
        "enabled": True,
        "path": str(path),
        "sha256": sha256_file(path),
        "snapshotSha256": snapshot_sha256,
        "reviewedBy": reviewed_by,
        "reviewedAt": reviewed_at,
        "finalPayloadFingerprint": payload_fingerprint,
        "trackedAtHead": tracked_at_head if require_committed and approved_removals else None,
        "cleanAtHead": clean_at_head if require_committed and approved_removals else None,
        "records": normalized_records,
    }, approved_removals


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

    # WordPress often renders derivatives or directly linked audio without an
    # attachment row. Every published-content reference must remain in the
    # inventory even when its source file is missing, so coverage cannot become
    # green merely because an absent path disappeared from the media records.
    for relative in sorted(references):
        if relative not in allowed_paths:
            encoded_relative = urllib.parse.quote(relative, safe="/")
            allowed_paths[relative] = f"{LEGACY_ORIGIN}/wp-content/uploads/{encoded_relative}"

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
        attachment_id = text(attachment.get("id")) or f"referenced-{hashlib.sha256(relative.encode('utf-8')).hexdigest()[:20]}"
        referenced_by = set(references.get(relative, set()))
        if relative in public_sitemap_paths:
            referenced_by.add("legacy-public-sitemap")
        visibility = "public" if referenced_by else "private"
        source_path = safe_restricted_media_file(restricted_root, relative) if verify else None
        exists = source_path is not None
        size = source_path.stat().st_size if source_path else None
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


def merge_external_media_records(
    media_records: Sequence[MediaRecord],
    external_media_records: Sequence[MediaRecord],
) -> list[MediaRecord]:
    """Replace only the synthetic records created from localized external-image references."""
    records_by_path: dict[str, MediaRecord] = {}
    records_by_identity: dict[str, MediaRecord] = {}
    for record in media_records:
        if record.relative_path in records_by_path:
            raise RuntimeError(f"Media inventory has a duplicate path: {record.relative_path}")
        if record.attachment_id in records_by_identity:
            raise RuntimeError(f"Media inventory has a duplicate identity: {record.attachment_id}")
        records_by_path[record.relative_path] = record
        records_by_identity[record.attachment_id] = record

    for external_record in external_media_records:
        existing = records_by_path.get(external_record.relative_path)
        if existing is not None:
            expected_placeholder_url = (
                f"{LEGACY_ORIGIN}/wp-content/uploads/"
                f"{urllib.parse.quote(external_record.relative_path, safe='/')}"
            )
            replaceable_placeholder = (
                existing.attachment_id.startswith("referenced-")
                and existing.source_url == expected_placeholder_url
                and existing.visibility == "public"
                and existing.exists
                and existing.size_bytes == external_record.size_bytes
                and existing.mime_type == external_record.mime_type
            )
            if not replaceable_placeholder:
                raise RuntimeError(
                    "External image backup collides with an existing media path: "
                    f"{external_record.relative_path}"
                )
            records_by_identity.pop(existing.attachment_id)

        identity_collision = records_by_identity.get(external_record.attachment_id)
        if identity_collision is not None and identity_collision.relative_path != external_record.relative_path:
            raise RuntimeError(
                "External image backup collides with an existing media identity: "
                f"{external_record.attachment_id}"
            )
        records_by_path[external_record.relative_path] = external_record
        records_by_identity[external_record.attachment_id] = external_record

    return sorted(records_by_path.values(), key=lambda record: record.relative_path)


def build_media_reference_coverage(
    references: defaultdict[str, set[str]],
    media_records: Sequence[MediaRecord],
    replacement_media_targets: dict[str, str],
    approved_reference_removals: dict[str, tuple[str, ...]],
    reviewed_payload_fingerprint: str,
    actual_payload_fingerprint: str,
    rejected_references: Sequence[dict[str, str]],
    verify_enabled: bool,
) -> dict[str, Any]:
    records_by_path = {record.relative_path: record for record in media_records}
    coverage_references: defaultdict[str, set[str]] = defaultdict(set)
    for relative_path, referenced_by in references.items():
        coverage_references[relative_path].update(referenced_by)
    for record in media_records:
        if "legacy-public-sitemap" in record.referenced_by:
            coverage_references[record.relative_path].add("legacy-public-sitemap")
    coverage_records: list[dict[str, Any]] = []
    applied_reviewed_removals: set[str] = set()
    reviewed_reference_drift: list[dict[str, Any]] = []
    reviewed_payload_matches = (
        not approved_reference_removals
        or reviewed_payload_fingerprint == actual_payload_fingerprint
    )
    for relative_path, referenced_by in sorted(coverage_references.items()):
        media_record = records_by_path.get(relative_path)
        replacement_url = text(replacement_media_targets.get(relative_path))
        if media_record and media_record.visibility == "public" and media_record.exists:
            disposition = "verified-public-file"
            public_target = f"/media/legacy/{relative_path}"
        elif public_episode_track_id_from_url(replacement_url):
            disposition = "verified-aic-audio-replacement"
            public_target = replacement_url
        elif (
            relative_path in approved_reference_removals
            and reviewed_payload_matches
            and approved_reference_removals[relative_path] == tuple(sorted(referenced_by))
        ):
            disposition = "reviewed-reference-removal"
            public_target = ""
            applied_reviewed_removals.add(relative_path)
        else:
            disposition = "missing-public-reference"
            public_target = ""
            if relative_path in approved_reference_removals:
                reviewed_reference_drift.append({
                    "relativePath": relative_path,
                    "approvedReferencedBy": list(approved_reference_removals[relative_path]),
                    "actualReferencedBy": sorted(referenced_by),
                })
        mime_type = text(media_record.mime_type if media_record else mimetypes.guess_type(relative_path)[0])
        classification = (
            "audio" if mime_type.startswith("audio/") or relative_path.casefold().endswith(".mp3")
            else "image" if mime_type.startswith("image/")
            else "document" if mime_type in {"application/pdf", "text/plain"}
            else "other"
        )
        coverage_records.append({
            "relativePath": relative_path,
            "normalizedSourceUrl": f"{LEGACY_ORIGIN}/wp-content/uploads/{urllib.parse.quote(relative_path, safe='/')}",
            "referencedBy": sorted(referenced_by),
            "classification": classification,
            "disposition": disposition,
            "publicTarget": public_target,
        })
    counts = Counter(text(record.get("disposition")) for record in coverage_records)
    return {
        "enabled": verify_enabled,
        "encountered": len(coverage_records),
        "verifiedPublicFiles": counts["verified-public-file"],
        "verifiedReplacements": counts["verified-aic-audio-replacement"],
        "reviewedRemovals": counts["reviewed-reference-removal"],
        "unexpectedReviewedRemovals": sorted(set(approved_reference_removals) - applied_reviewed_removals),
        "reviewedReferenceDrift": reviewed_reference_drift,
        "reviewedPayloadFingerprint": reviewed_payload_fingerprint,
        "actualPayloadFingerprint": actual_payload_fingerprint,
        "reviewedPayloadFingerprintDrift": bool(approved_reference_removals) and not reviewed_payload_matches,
        "rejectedReferences": list(rejected_references),
        "blockingReferences": [
            record for record in coverage_records
            if record["disposition"] == "missing-public-reference"
        ],
        "records": coverage_records,
    }


def validate_media_reference_coverage(coverage: dict[str, Any]) -> None:
    records = coverage.get("records")
    if not coverage.get("enabled") or not isinstance(records, list):
        raise RuntimeError("Apply preflight failed: published media reference coverage was not verified")
    counts = Counter(
        text(record.get("disposition"))
        for record in records
        if isinstance(record, dict)
    )
    if (
        coverage.get("encountered") != len(records)
        or coverage.get("verifiedPublicFiles") != counts["verified-public-file"]
        or coverage.get("verifiedReplacements") != counts["verified-aic-audio-replacement"]
        or coverage.get("reviewedRemovals") != counts["reviewed-reference-removal"]
        or coverage.get("blockingReferences")
        or coverage.get("rejectedReferences")
        or coverage.get("unexpectedReviewedRemovals")
        or coverage.get("reviewedReferenceDrift")
        or coverage.get("reviewedPayloadFingerprintDrift")
        or len(records) != counts["verified-public-file"] + counts["verified-aic-audio-replacement"] + counts["reviewed-reference-removal"]
        or any(
            not text(record.get("relativePath"))
            or not text(record.get("normalizedSourceUrl")).startswith(f"{LEGACY_ORIGIN}/wp-content/uploads/")
            or not record.get("referencedBy")
            or text(record.get("classification")) not in {"audio", "image", "document", "other"}
            or (
                text(record.get("disposition")) != "reviewed-reference-removal"
                and not text(record.get("publicTarget")).startswith("/media/")
            )
            or (
                text(record.get("disposition")) == "reviewed-reference-removal"
                and text(record.get("publicTarget"))
            )
            for record in records
            if isinstance(record, dict)
        )
    ):
        raise RuntimeError("Apply preflight failed: published media reference coverage is incomplete")


def apply_verified_media_replacements(
    record_groups: Sequence[list[dict[str, Any]]],
    replacement_media_targets: dict[str, str],
    approved_reference_removals: set[str],
) -> None:
    if not replacement_media_targets and not approved_reference_removals:
        return

    unavailable_markup = "<span>Media unavailable.</span>"
    url_value_fields = {
        "externalAudioUrl", "legacyPhotoUrl", "publicPath", "imageUrl", "audioUrl", "videoUrl", "posterUrl",
    }

    def remove_reviewed_target(value: str, target: str, field_name: str) -> str:
        if field_name in url_value_fields and value.strip() == target:
            return ""
        escaped_target = re.escape(target)
        attribute_value = rf'(?:"{escaped_target}"|\'{escaped_target}\'|{escaped_target})(?=\s|/?>)'
        # A srcset contains comma-separated URL candidates and descriptors.
        # Replacing a candidate with prose would create a bogus relative URL
        # that the browser could request from the current page. Remove the
        # complete attribute when it contains the exact reviewed target; a
        # normal src/poster fallback, when present, remains intact.
        srcset_attribute = re.compile(
            r'''\s+srcset\s*=\s*(?:"(?P<double>[^"]*)"|'(?P<single>[^']*)'|(?P<bare>[^\s>]+))''',
            re.I,
        )

        def remove_matching_srcset(match: re.Match[str]) -> str:
            srcset_value = next(
                (
                    candidate
                    for candidate in (match.group("double"), match.group("single"), match.group("bare"))
                    if candidate is not None
                ),
                "",
            )
            candidate_urls = [
                candidate.strip().split(None, 1)[0]
                for candidate in srcset_value.split(",")
                if candidate.strip()
            ]
            return "" if target in candidate_urls else match.group(0)

        value = srcset_attribute.sub(remove_matching_srcset, value)
        media_binding = rf"\b(?:src|poster|data|action)\s*=\s*{attribute_value}"
        paired_media = re.compile(
            rf"<(?P<tag>audio|video|iframe|object|form)\b(?=[^>]*{media_binding})[^>]*>.*?</(?P=tag)\s*>",
            re.I | re.S,
        )
        value = paired_media.sub(unavailable_markup, value)
        anchor = re.compile(
            rf"<a\b(?=[^>]*\b(?:href|formaction)\s*=\s*{attribute_value})[^>]*>(.*?)</a\s*>",
            re.I | re.S,
        )
        value = anchor.sub(lambda match: f"{match.group(1)} {unavailable_markup}", value)
        interactive = re.compile(
            rf"<button\b(?=[^>]*\bformaction\s*=\s*{attribute_value})[^>]*>(.*?)</button\s*>",
            re.I | re.S,
        )
        value = interactive.sub(lambda match: f"{match.group(1)} {unavailable_markup}", value)
        void_media = re.compile(
            rf"<(?:audio|video|iframe|object|img|source|track|embed|input)\b(?=[^>]*(?:{media_binding}|\bformaction\s*=\s*{attribute_value}))[^>]*?/?>",
            re.I | re.S,
        )
        value = void_media.sub(unavailable_markup, value)
        url_attribute = re.compile(
            rf"\s+(?:href|src|poster|srcset|action|formaction)\s*=\s*{attribute_value}",
            re.I,
        )
        value = url_attribute.sub("", value)

        def replace_plain_reference(match: re.Match[str]) -> str:
            relative_path, trailing = normalize_legacy_upload_reference(
                match.group(0).removeprefix("/media/legacy/")
            )
            expected_relative = target.removeprefix("/media/legacy/")
            return f"Media unavailable.{trailing}" if relative_path == expected_relative else match.group(0)

        return LOCAL_LEGACY_MEDIA_PATTERN.sub(replace_plain_reference, value)

    def rewrite(value: Any, field_name: str = "") -> Any:
        if isinstance(value, str):
            def replace_verified(match: re.Match[str]) -> str:
                relative_path, trailing = normalize_legacy_upload_reference(
                    match.group(0).removeprefix("/media/legacy/")
                )
                public_target = replacement_media_targets.get(relative_path or "")
                return f"{public_target}{trailing}" if public_target else match.group(0)

            value = LOCAL_LEGACY_MEDIA_PATTERN.sub(replace_verified, value)
            matched_removals = {
                relative_path
                for raw_target in LOCAL_LEGACY_MEDIA_PATTERN.findall(value)
                if (relative_path := normalize_legacy_upload_reference(
                    raw_target.removeprefix("/media/legacy/")
                )[0]) in approved_reference_removals
            }
            for relative_path in sorted(matched_removals, key=lambda item: (-len(item), item)):
                value = remove_reviewed_target(
                    value,
                    f"/media/legacy/{relative_path}",
                    field_name,
                )
            return value
        if isinstance(value, list):
            return [rewrite(item, field_name) for item in value]
        if isinstance(value, dict):
            return {key: rewrite(item, key) for key, item in value.items()}
        return value

    for records in record_groups:
        for record in records:
            rewritten = rewrite(record)
            record.clear()
            record.update(rewritten)
            if "sourceFingerprint" in record:
                record["sourceFingerprint"] = ""
                record["sourceFingerprint"] = stable_fingerprint(record)


def audit_final_public_media_targets(
    record_groups: dict[str, Sequence[dict[str, Any]]],
    media_records: Sequence[MediaRecord],
    verify_enabled: bool,
    verified_episode_track_ids: set[str] | None = None,
) -> dict[str, Any]:
    verified_paths = {
        record.relative_path
        for record in media_records
        if record.visibility == "public" and record.exists
    }
    references: defaultdict[str, set[str]] = defaultdict(set)
    invalid_targets: list[dict[str, str]] = []
    episode_targets: list[dict[str, str]] = []
    invalid_episode_targets: list[dict[str, str]] = []
    unverified_episode_targets: list[dict[str, str]] = []

    def inspect(value: Any, source: str) -> None:
        if isinstance(value, str):
            for match in LEGACY_UPLOAD_URL_PATTERN.findall(value):
                invalid_targets.append({
                    "source": source,
                    "target": match,
                    "reason": "legacy-origin-upload-was-not-localized",
                })
            for match in LOCAL_LEGACY_MEDIA_PATTERN.findall(value):
                relative_path, _trailing = normalize_legacy_upload_reference(
                    match.removeprefix("/media/legacy/")
                )
                if relative_path:
                    references[relative_path].add(source)
                else:
                    invalid_targets.append({
                        "source": source,
                        "target": match,
                        "reason": "invalid-local-legacy-media-target",
                    })
            for match in LOCAL_EPISODE_MEDIA_PATTERN.findall(value):
                track_id, _trailing = normalize_public_episode_url_match(match)
                record = {"source": source, "target": match, "trackId": track_id}
                if track_id:
                    episode_targets.append(record)
                    if verified_episode_track_ids is not None and track_id not in verified_episode_track_ids:
                        unverified_episode_targets.append(record)
                else:
                    invalid_episode_targets.append(record)
        elif isinstance(value, list):
            for item in value:
                inspect(item, source)
        elif isinstance(value, dict):
            for item in value.values():
                inspect(item, source)

    identity_fields = ("pageKey", "legacyId", "trackId", "slug")
    for kind, records in record_groups.items():
        for index, record in enumerate(records):
            identity = next((text(record.get(field)) for field in identity_fields if text(record.get(field))), str(index))
            inspect(record, f"{kind}:{identity}")

    target_records = [
        {
            "relativePath": relative_path,
            "referencedBy": sorted(referenced_by),
            "verified": relative_path in verified_paths,
        }
        for relative_path, referenced_by in sorted(references.items())
    ]
    return {
        "enabled": verify_enabled,
        "targets": len(target_records),
        "verifiedTargets": sum(1 for record in target_records if record["verified"]),
        "blockingTargets": [record for record in target_records if not record["verified"]],
        "invalidTargets": invalid_targets,
        "episodeTargets": episode_targets,
        "invalidEpisodeTargets": invalid_episode_targets,
        "unverifiedEpisodeTargets": unverified_episode_targets,
        "records": target_records,
    }


def validate_final_public_media_targets(audit: dict[str, Any]) -> None:
    records = audit.get("records")
    if (
        not audit.get("enabled")
        or not isinstance(records, list)
        or audit.get("targets") != len(records)
        or audit.get("verifiedTargets") != len(records)
        or audit.get("blockingTargets")
        or audit.get("invalidTargets")
        or audit.get("invalidEpisodeTargets")
        or audit.get("unverifiedEpisodeTargets")
        or any(not isinstance(record, dict) or record.get("verified") is not True for record in records)
    ):
        raise RuntimeError("Apply preflight failed: final public payload contains an unverified legacy media target")


def redirect_target_for(
    path: str,
    post_slug_targets: dict[str, str],
    sermon_slug_targets: dict[str, str],
    public_media_paths: set[str],
    replacement_media_targets: dict[str, str] | None = None,
    page_slug_targets: dict[str, str] | None = None,
) -> tuple[str | None, str]:
    # The existing /privacy route belongs to the separate Sermon Search GPT
    # policy surface. Import the legacy PastorWood page under
    # /privacy-terms-conditions, but never create a redirect that takes
    # ownership of /privacy away from that application.
    normalized_source = path.rstrip("/").casefold()
    if normalized_source == "/privacy" or normalized_source.startswith("/privacy/"):
        return None, "owned-current-sermon-search-gpt-route"
    if "/wp-content/uploads/" in path:
        relative_media = safe_upload_relative_path(path)
        if relative_media in public_media_paths:
            return f"/media/legacy/{relative_media}", "public-attachment"
        if relative_media and replacement_media_targets and relative_media in replacement_media_targets:
            return replacement_media_targets[relative_media], "canonical-episode-audio"
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
        if len(parts) >= 2 and parts[1] in {"book", "preacher", "series", "topics", "service-type"}:
            return "/radio/", "radio-taxonomy-archive-fallback"
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
    if page_slug_targets and final_slug in page_slug_targets:
        return page_slug_targets[final_slug], "published-page"
    if path.startswith("/category/weekly-devotional") or path.startswith("/tag/"):
        return "/bible-study/", "taxonomy-fallback"
    if path.startswith("/category/resources"):
        return "/written-resources/", "taxonomy-fallback"
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
    replacement_media_targets: dict[str, str] | None = None,
    sermon_alias_targets: dict[str, str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, str]], list[dict[str, str]]]:
    post_slug_targets = {text(row.get("slug")): f"/writings/{text(row.get('slug'))}/" for row in posts}
    page_slug_targets: dict[str, str] = {}
    sermon_slug_targets: dict[str, str] = {}
    episode_by_wp = {text(row.get("wpSermonId")): row for row in episodes if text(row.get("wpSermonId"))}
    for row in wp_content:
        if text(row.get("type")) != "wpfc_sermon":
            continue
        target_episode = episode_by_wp.get(text(row.get("id")))
        if target_episode:
            sermon_slug_targets[slugify(text(row.get("slug")), "")] = f"/radio/{text(target_episode.get('slug'))}/"
        elif sermon_alias_targets and text(row.get("id")) in sermon_alias_targets:
            sermon_slug_targets[slugify(text(row.get("slug")), "")] = sermon_alias_targets[text(row.get("id"))]
    for row in wp_content:
        if text(row.get("type")) != "page":
            continue
        slug = slugify(text(row.get("slug")), f"page-{text(row.get('id'))}")
        if slug in OPERATIONAL_PAGE_SLUGS:
            continue
        if not text(row.get("title")) and not strip_markup(text(row.get("content"))) and not strip_markup(text(row.get("excerpt"))):
            continue
        page_slug_targets[slug] = FIXED_PAGE_TARGETS.get(slug, f"/{slug}/")
    public_media_paths = {record.relative_path for record in media_records if record.visibility == "public" and record.exists}

    redirects: dict[str, dict[str, Any]] = {}
    failures: list[dict[str, str]] = []
    unmatched: list[dict[str, str]] = []
    for input_index, raw_url in enumerate(legacy_urls, start=1):
        try:
            path, source_url = normalize_legacy_url(raw_url)
            if is_reserved_route(path):
                raise ValueError("legacy source overlaps a current reserved route")
            target, reason = redirect_target_for(
                path,
                post_slug_targets,
                sermon_slug_targets,
                public_media_paths,
                replacement_media_targets,
                page_slug_targets,
            )
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
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
        directory_descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        temporary.unlink(missing_ok=True)


def deployed_git_revision(repository_root: Path | None = None) -> str:
    root = (repository_root or Path(__file__).resolve().parents[1]).resolve()
    environment = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--show-toplevel", "--verify", "HEAD^{commit}"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
            env=environment,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("Cutover attestation requires the deployed Git revision") from error
    lines = result.stdout.strip().splitlines()
    if len(lines) != 2 or Path(lines[0]).resolve() != root:
        raise RuntimeError("Cutover attestation repository root is invalid")
    revision = lines[1].lower()
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise RuntimeError("Cutover attestation received an invalid deployed Git revision")
    try:
        status = subprocess.run(
            ["git", "-C", str(root), "status", "--porcelain", "--untracked-files=no"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
            env=environment,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError("Cutover attestation could not verify the deployed checkout") from error
    if status.stdout.strip():
        raise RuntimeError("Cutover attestation refuses a tracked dirty checkout")
    return revision


def _validate_cutover_attestation_output(path: Path, allow_test_output: bool) -> None:
    if not path.is_absolute() or path.name != DEFAULT_CUTOVER_ATTESTATION.name:
        raise RuntimeError("Cutover attestation output path is invalid")
    resolved_parent = path.parent.resolve()
    if allow_test_output:
        temporary_root = Path(tempfile.gettempdir()).resolve()
        if resolved_parent != temporary_root and temporary_root not in resolved_parent.parents:
            raise RuntimeError("Test cutover attestation output must stay below the system temporary root")
    elif path != DEFAULT_CUTOVER_ATTESTATION or resolved_parent != DEFAULT_MIGRATION_ROOT:
        raise RuntimeError("Cutover attestation may only be written to the immutable migration root")
    if not path.parent.exists() or path.parent.is_symlink() or not path.parent.is_dir():
        raise RuntimeError("Cutover attestation root must be an existing non-symlink directory")
    for candidate in (path, Path(f"{path}.sha256")):
        if candidate.is_symlink() or (candidate.exists() and not candidate.is_file()):
            raise RuntimeError("Cutover attestation destination must be a regular non-symlink file")


def write_cutover_attestation_pair(
    attestation: dict[str, Any],
    path: Path = DEFAULT_CUTOVER_ATTESTATION,
    *,
    allow_test_output: bool = False,
) -> str:
    _validate_cutover_attestation_output(path, allow_test_output)
    payload = (json.dumps(attestation, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    digest = hashlib.sha256(payload).hexdigest()
    checksum_path = Path(f"{path}.sha256")
    checksum_payload = f"{digest}  {path.name}\n".encode("ascii")
    temporary_paths: list[Path] = []
    try:
        for destination, contents in ((checksum_path, checksum_payload), (path, payload)):
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{destination.name}.",
                suffix=".tmp",
                dir=path.parent,
            )
            temporary = Path(temporary_name)
            temporary_paths.append(temporary)
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(contents)
                handle.flush()
                os.fsync(handle.fileno())

        # The JSON is the commit marker. If a crash lands between these two
        # replacements, the checksum and prior JSON disagree and every reader
        # fails closed instead of trusting partial evidence.
        temporary_paths[0].replace(checksum_path)
        temporary_paths[1].replace(path)
        directory_descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        for temporary in temporary_paths:
            temporary.unlink(missing_ok=True)
    return digest


def build_cutover_attestation(
    *,
    plan_fingerprint: str,
    mutation_manifest_sha256: str,
    expected_entries: dict[str, dict[str, Any]],
    publication_actions: dict[str, dict[str, Any]],
    publication_manifest: Path,
    cache_invalidation_state: str,
    verified_redirect_keys: set[str],
    failure_evidence: dict[str, Any],
    git_revision: str,
    completed_at: str | None = None,
) -> dict[str, Any]:
    if not re.fullmatch(r"[a-f0-9]{64}", plan_fingerprint):
        raise RuntimeError("Cutover attestation plan fingerprint is invalid")
    if not re.fullmatch(r"[a-f0-9]{64}", mutation_manifest_sha256):
        raise RuntimeError("Cutover attestation mutation manifest SHA-256 is invalid")
    if not re.fullmatch(r"[a-f0-9]{40}", git_revision):
        raise RuntimeError("Cutover attestation deployed Git revision is invalid")
    if failure_evidence.get("planFingerprint") != plan_fingerprint or failure_evidence.get("failures") != []:
        raise RuntimeError("Cutover attestation refuses missing, stale, or nonempty failure evidence")

    actionable = {
        key: entry
        for key, entry in expected_entries.items()
        if entry.get("action") in {"publish", "activate"}
    }
    if set(publication_actions) != set(actionable):
        raise RuntimeError("Cutover attestation refuses a partial reviewed publication phase")
    ordered_actions = sorted(publication_actions.values(), key=lambda action: int(action.get("sequence") or 0))
    if [action.get("sequence") for action in ordered_actions] != list(range(1, len(ordered_actions) + 1)):
        raise RuntimeError("Cutover attestation refuses incomplete publication ordering evidence")
    for action in ordered_actions:
        key = text(action.get("key"))
        expected_action = "activated" if actionable[key]["action"] == "activate" else "published"
        if text(action.get("action")) != expected_action or not text(action.get("recordedAt")):
            raise RuntimeError("Cutover attestation publication action does not match the reviewed plan")

    publish_sequences = [action["sequence"] for action in ordered_actions if action.get("action") == "published"]
    redirect_actions = [action for action in ordered_actions if action.get("action") == "activated"]
    redirect_keys = {key for key, entry in actionable.items() if entry.get("action") == "activate"}
    if verified_redirect_keys != redirect_keys:
        raise RuntimeError("Cutover attestation refuses incomplete redirect activation verification")
    if redirect_actions and publish_sequences and min(action["sequence"] for action in redirect_actions) <= max(publish_sequences):
        raise RuntimeError("Cutover attestation requires redirects to be activated after every publication")
    if cache_invalidation_state != "complete":
        raise RuntimeError("Cutover attestation refuses pending cache invalidation")

    if publication_manifest.is_symlink() or not publication_manifest.is_file():
        raise RuntimeError("Cutover attestation requires a regular non-symlink publication manifest")
    try:
        manifest_payload = json.loads(publication_manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("Cutover attestation requires the final publication manifest") from error
    manifest_actions = manifest_payload.get("actions") if isinstance(manifest_payload, dict) else None
    invalidation = manifest_payload.get("cacheInvalidation") if isinstance(manifest_payload, dict) else None
    expected_exclusions = [
        {
            "key": key,
            "kind": text(entry.get("kind")),
            "identity": text(entry.get("identity")),
            "reason": text(entry.get("exclusionReason")),
        }
        for key, entry in sorted(expected_entries.items())
        if entry.get("action") == "exclude"
    ]
    if (
        not isinstance(manifest_payload, dict)
        or manifest_payload.get("version") != 1
        or manifest_payload.get("planFingerprint") != plan_fingerprint
        or manifest_payload.get("mutationManifestSha256") != mutation_manifest_sha256
        or manifest_actions != ordered_actions
        or manifest_payload.get("exclusions") != expected_exclusions
        or not isinstance(invalidation, dict)
        or invalidation.get("state") != "complete"
        or invalidation.get("actionsFingerprint") != stable_fingerprint(ordered_actions)
        or not text(invalidation.get("updatedAt"))
    ):
        raise RuntimeError("Cutover attestation publication manifest is incomplete or stale")

    completion = completed_at or datetime.now(timezone.utc).isoformat()
    return {
        "version": 1,
        "planFingerprint": plan_fingerprint,
        "mutationManifestSha256": mutation_manifest_sha256,
        "publication": {
            "manifestSha256": sha256_file(publication_manifest),
            "evidenceHash": stable_fingerprint(ordered_actions),
            "actionsFingerprint": text(invalidation.get("actionsFingerprint")),
            "expectedActionCount": len(actionable),
            "completedActionCount": len(ordered_actions),
            "verified": True,
        },
        "redirectActivation": {
            "expectedCount": len(redirect_keys),
            "activatedCount": len(redirect_actions),
            "verifiedCount": len(verified_redirect_keys),
            "evidenceHash": stable_fingerprint(redirect_actions),
            "activatedLast": True,
            "verified": True,
        },
        "cacheInvalidation": {
            "state": "complete",
            "flushed": True,
            "actionsFingerprint": text(invalidation.get("actionsFingerprint")),
            "completedAt": text(invalidation.get("updatedAt")),
        },
        "deployedGitRevision": git_revision,
        "completedAt": completion,
        "failures": [],
    }


def canonical_cache_revalidation_secret(env_values: dict[str, str]) -> str:
    secret = text(env_values.get("STRAPI_REVALIDATE_SECRET"))
    if not re.fullmatch(r"[a-f0-9]{64}", secret):
        raise RuntimeError("Canonical AIC environment is missing the cache-revalidation secret")
    return secret


def request_public_cache_invalidation(
    secret: str,
    source: str = PUBLIC_CACHE_INVALIDATION_SOURCE,
    *,
    urlopen: Any = None,
) -> None:
    if not re.fullmatch(r"[a-f0-9]{64}", secret):
        raise RuntimeError("Public cache invalidation secret is not configured")
    if not re.fullmatch(r"[a-z0-9-]{1,64}", source):
        raise RuntimeError("Public cache invalidation source is invalid")
    body = json.dumps({"event": "entry.publish", "source": source}, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        PUBLIC_CACHE_INVALIDATION_URL,
        data=body,
        method="POST",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
        },
    )
    opener = urlopen or urllib.request.urlopen
    try:
        with opener(request, timeout=10) as response:
            status_value = getattr(response, "status", None)
            status = int(status_value if status_value is not None else response.getcode())
            response_body = response.read(65_537)
    except (OSError, TimeoutError, urllib.error.URLError, urllib.error.HTTPError) as error:
        raise RuntimeError("Public cache invalidation route is unavailable") from error
    if not 200 <= status < 300 or len(response_body) > 65_536:
        raise RuntimeError(f"Public cache invalidation was not confirmed (HTTP {status})")
    try:
        payload = json.loads(response_body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("Public cache invalidation route returned an invalid response") from error
    if not isinstance(payload, dict) or payload.get("revalidated") is not True:
        raise RuntimeError(f"Public cache invalidation was not confirmed (HTTP {status})")


class StrapiClient:
    CANONICAL_BASE_URL = "http://127.0.0.1:1337"
    ENTITY_TYPES = {
        "pages": "page",
        "posts": "post",
        "episodes": "episode",
        "people": "person",
        "endorsements": "endorsement",
        "media-assets": "media-asset",
        "redirects": "redirect",
    }
    CUTOVER_ACTOR = {
        "id": "pastorwood-cutover",
        "email": "cutover@pastorwood.org",
        "name": "PastorWood verified cutover",
    }

    def __init__(self, base_url: str, token: str):
        if not base_url or not token:
            raise RuntimeError("Applying requires the canonical Strapi URL and scoped management token")
        self.base_url = base_url.rstrip("/")
        if self.base_url != self.CANONICAL_BASE_URL:
            raise RuntimeError(f"Cutover mutations require canonical Strapi at {self.CANONICAL_BASE_URL}")
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
    ) -> dict[str, Any]:
        entity_type = self.ENTITY_TYPES.get(api_path)
        if not entity_type:
            raise RuntimeError(f"Unsupported editorial collection: {api_path}")
        mutation_data = dict(data)
        if publishable and api_path in {"pages", "posts", "episodes"}:
            # Phase one must always leave imported content unscheduled. Without
            # this explicit clear, updating an existing due draft can preserve
            # its old schedule and let the publication worker publish it before
            # the independently reviewed phase-two manifest is applied.
            mutation_data["scheduledFor"] = None
        query = urllib.parse.urlencode({
            f"filters[{identity_field}][$eq]": identity_value,
            "pagination[pageSize]": "1",
            **({"status": "draft"} if publishable else {}),
        })
        response = self.request(f"/api/{api_path}?{query}") or {}
        matches = response.get("data") if isinstance(response, dict) else []
        if not isinstance(matches, list):
            raise RuntimeError(f"Strapi {api_path} lookup returned an invalid data collection")
        if len(matches) > 1:
            raise RuntimeError(f"Strapi {api_path} identity is not unique: {identity_field}={identity_value}")
        existing = matches[0] if matches else None
        document_id = text(existing.get("documentId")) if isinstance(existing, dict) else ""
        before = self._entity_data(existing)
        if document_id:
            expected_updated_at = text(before.get("updatedAt"))
            if not expected_updated_at:
                raise RuntimeError(f"Existing {entity_type} has no concurrency timestamp")
            self.request(
                f"/api/editorial/{entity_type}/{urllib.parse.quote(document_id)}/baseline",
                "POST",
                {
                    "actor": self.CUTOVER_ACTOR,
                    "note": "Adopted an existing pre-cutover draft as an immutable editorial baseline.",
                },
            )
            result = self.request(
                f"/api/editorial/{entity_type}/{urllib.parse.quote(document_id)}",
                "PUT",
                {
                    "actor": self.CUTOVER_ACTOR,
                    "data": mutation_data,
                    "expectedUpdatedAt": expected_updated_at,
                    "note": "Updated from the checksum-pinned PastorWood cutover plan; retained as a draft for validation.",
                },
            )
            outcome = "updated"
        else:
            result = self.request(
                f"/api/editorial/{entity_type}",
                "POST",
                {
                    "actor": self.CUTOVER_ACTOR,
                    "data": mutation_data,
                    "note": "Created from the checksum-pinned PastorWood cutover plan; retained as a draft for validation.",
                },
            )
            outcome = "created"
        result_entity = result.get("data") if isinstance(result, dict) else None
        after = self._entity_data(result_entity)
        result_document_id = text(after.get("documentId")) or document_id
        if not result_document_id:
            raise RuntimeError(f"Editorial {outcome} for {entity_type} returned no document id")
        return {
            "outcome": outcome,
            "documentId": result_document_id,
            "publicationState": "draft" if publishable else "not-publishable",
            "beforeUpdatedAt": text(before.get("updatedAt")),
            "afterUpdatedAt": text(after.get("updatedAt")),
            "beforeFingerprint": stable_fingerprint(before) if before else "",
            "afterFingerprint": stable_fingerprint(after),
        }

    @staticmethod
    def _entity_data(value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            return {}
        attributes = value.get("attributes")
        if isinstance(attributes, dict):
            return {**attributes, **{key: item for key, item in value.items() if key != "attributes"}}
        return dict(value)

    def list_collection(self, api_path: str, *, status: str | None) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        page = 1
        while True:
            query_values = {
                "pagination[page]": str(page),
                "pagination[pageSize]": "100",
            }
            if status:
                query_values["status"] = status
            response = self.request(f"/api/{api_path}?{urllib.parse.urlencode(query_values)}") or {}
            data = response.get("data") if isinstance(response, dict) else None
            if not isinstance(data, list):
                raise RuntimeError(f"Strapi {api_path} inventory returned invalid data")
            records.extend(self._entity_data(item) for item in data)
            pagination = response.get("meta", {}).get("pagination", {}) if isinstance(response, dict) else {}
            page_count = pagination.get("pageCount") if isinstance(pagination, dict) else None
            if isinstance(page_count, int):
                if page >= page_count:
                    break
            elif len(data) < 100:
                break
            else:
                raise RuntimeError(f"Strapi {api_path} inventory omitted bounded pagination metadata")
            page += 1
        return records

    def publish_reviewed(self, entity_type: str, document_id: str, expected_updated_at: str) -> dict[str, Any]:
        result = self.request(
            f"/api/editorial/{entity_type}/{urllib.parse.quote(document_id)}/publish",
            "POST",
            {
                "actor": self.CUTOVER_ACTOR,
                "expectedUpdatedAt": expected_updated_at,
                "note": "Published only after the separately confirmed PastorWood cutover draft/count/media review.",
            },
        )
        after = self._entity_data(result.get("data") if isinstance(result, dict) else None)
        if text(after.get("documentId")) != document_id:
            raise RuntimeError(f"Editorial publication returned the wrong document id for {entity_type}")
        return after

    def activate_reviewed_redirect(self, document_id: str, expected_updated_at: str) -> dict[str, Any]:
        result = self.request(
            f"/api/editorial/redirect/{urllib.parse.quote(document_id)}",
            "PUT",
            {
                "actor": self.CUTOVER_ACTOR,
                "data": {"active": True},
                "expectedUpdatedAt": expected_updated_at,
                "note": "Activated only after all eligible reviewed cutover drafts were published successfully.",
            },
        )
        after = self._entity_data(result.get("data") if isinstance(result, dict) else None)
        if text(after.get("documentId")) != document_id or after.get("active") is not True:
            raise RuntimeError("Editorial redirect activation returned invalid state")
        return after


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
    resolved_public_root = public_root.resolve()
    resolved_destination = destination.resolve(strict=False)
    if resolved_destination.parent != resolved_public_root and resolved_public_root not in resolved_destination.parents:
        raise RuntimeError(f"media destination escaped the public root: {relative}")
    source_checksum = sha256_file(source)
    if destination.exists() or destination.is_symlink():
        if not destination.is_file() or destination.is_symlink():
            raise RuntimeError(f"unexplained media destination collision: {relative}")
        if sha256_file(destination) != source_checksum:
            raise RuntimeError(f"unexplained media destination checksum collision: {relative}")
        return source_checksum, destination.stat().st_size

    temporary = destination.with_name(f".{destination.name}.{os.getpid()}.cutover-tmp")
    if temporary.exists() or temporary.is_symlink():
        raise RuntimeError(f"unexplained temporary media destination collision: {relative}")
    try:
        shutil.copy2(source, temporary)
        if sha256_file(temporary) != source_checksum:
            raise RuntimeError(f"checksum verification failed while copying {relative}")
        try:
            os.link(temporary, destination)
        except FileExistsError:
            if not destination.is_file() or destination.is_symlink() or sha256_file(destination) != source_checksum:
                raise RuntimeError(f"unexplained concurrent media destination collision: {relative}")
    finally:
        temporary.unlink(missing_ok=True)
    destination_checksum = sha256_file(destination)
    if destination_checksum != source_checksum:
        raise RuntimeError(f"destination checksum mismatch for {relative}")
    return source_checksum, destination.stat().st_size


def verify_phase1_public_media_evidence(
    media_records: Sequence[MediaRecord],
    mutation_records: dict[str, dict[str, Any]],
    public_root: Path,
) -> dict[str, Any]:
    """Re-hash the exact phase-one public files before any reviewed publication."""
    expected = {
        f"media:{record.attachment_id}": record
        for record in media_records
        if record.visibility == "public" and record.exists
    }
    evidenced_keys = {
        key
        for key, mutation in mutation_records.items()
        if "publicMediaEvidence" in mutation
    }
    if evidenced_keys != set(expected):
        missing = sorted(set(expected) - evidenced_keys)[:20]
        unexpected = sorted(evidenced_keys - set(expected))[:20]
        raise RuntimeError(
            f"Phase-one public media evidence is not exact; missing={missing}, unexpected={unexpected}"
        )
    if public_root.is_symlink():
        raise RuntimeError("Public media root must not be a symlink")

    total_bytes = 0
    verified_records: list[dict[str, Any]] = []
    for key, record in sorted(expected.items()):
        mutation = mutation_records.get(key, {})
        evidence = mutation.get("publicMediaEvidence")
        expected_public_path = f"/media/legacy/{record.relative_path}"
        if (
            not isinstance(evidence, dict)
            or text(mutation.get("kind")) != "media"
            or text(mutation.get("identity")) != record.attachment_id
            or text(evidence.get("relativePath")) != record.relative_path
            or text(evidence.get("publicPath")) != expected_public_path
            or not isinstance(evidence.get("sizeBytes"), int)
            or isinstance(evidence.get("sizeBytes"), bool)
            or int(evidence.get("sizeBytes")) <= 0
            or evidence.get("sizeBytes") != record.size_bytes
            or not re.fullmatch(r"[a-f0-9]{64}", text(evidence.get("sha256")))
        ):
            raise RuntimeError(f"Phase-one public media evidence is invalid for {key}")
        public_file = safe_restricted_media_file(public_root, record.relative_path)
        if not public_file:
            raise RuntimeError(f"Phase-one public media file is missing, unsafe, or a symlink: {record.relative_path}")
        actual_size = public_file.stat().st_size
        if actual_size != evidence["sizeBytes"]:
            raise RuntimeError(f"Phase-one public media size drifted: {record.relative_path}")
        if sha256_file(public_file) != evidence["sha256"]:
            raise RuntimeError(f"Phase-one public media checksum drifted: {record.relative_path}")
        if public_file.stat().st_size != actual_size:
            raise RuntimeError(f"Phase-one public media changed during verification: {record.relative_path}")
        total_bytes += actual_size
        verified_records.append({
            "key": key,
            "relativePath": record.relative_path,
            "sha256": text(evidence.get("sha256")),
            "sizeBytes": actual_size,
        })
    return {
        "verifiedFiles": len(expected),
        "verifiedBytes": total_bytes,
        "evidenceFingerprint": stable_fingerprint(verified_records),
    }


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


def load_mutation_manifest(path: Path, plan_fingerprint: str, no_resume: bool = False) -> dict[str, dict[str, Any]]:
    if no_resume or not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Cutover mutation manifest is invalid: {error}") from error
    if not isinstance(value, dict) or value.get("version") != 1 or value.get("planFingerprint") != plan_fingerprint:
        raise RuntimeError("Cutover mutation manifest belongs to a different or invalid source plan")
    mutations = value.get("mutations")
    if not isinstance(mutations, list) or any(not isinstance(item, dict) for item in mutations):
        raise RuntimeError("Cutover mutation manifest records are invalid")
    records: dict[str, dict[str, Any]] = {}
    for mutation in mutations:
        key = text(mutation.get("key"))
        if not key or key in records or text(mutation.get("outcome")) not in {"created", "updated"}:
            raise RuntimeError("Cutover mutation manifest contains an invalid or duplicate identity")
        records[key] = dict(mutation)
    return records


def write_mutation_manifest(path: Path, plan_fingerprint: str, records: dict[str, dict[str, Any]]) -> None:
    write_json(path, {
        "version": 1,
        "planFingerprint": plan_fingerprint,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mutations": [records[key] for key in sorted(records)],
    })


def canonical_strapi_client(env_values: dict[str, str]) -> StrapiClient:
    token_values = {
        text(env_values.get(key))
        for key in ("STRAPI_API_TOKEN_TEMP_WRITE", "STRAPI_MANAGEMENT_TOKEN", "STRAPI_API_TOKEN")
        if text(env_values.get(key))
    }
    if len(token_values) != 1:
        raise RuntimeError("Canonical AIC environment must supply one unambiguous Strapi management token")
    url_values = {
        text(env_values.get(key)).rstrip("/")
        for key in ("STRAPI_MANAGEMENT_URL", "STRAPI_URL")
        if text(env_values.get(key))
    }
    if url_values != {StrapiClient.CANONICAL_BASE_URL}:
        raise RuntimeError(f"Canonical AIC environment must pin Strapi to {StrapiClient.CANONICAL_BASE_URL}")
    return StrapiClient(next(iter(url_values)), next(iter(token_values)))


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
    media_public_paths: dict[str, str],
    metadata_only_media_ids: set[str],
) -> dict[str, Any]:
    if args.confirm != APPLY_CONFIRMATION:
        raise RuntimeError(f"--apply requires --confirm {APPLY_CONFIRMATION}")
    client = canonical_strapi_client(env_values)
    completed = load_checkpoint(args.checkpoint, plan_fingerprint, args.no_resume)
    mutation_records = load_mutation_manifest(args.mutation_manifest, plan_fingerprint, args.no_resume)
    if completed - mutation_records.keys():
        raise RuntimeError("Cutover checkpoint contains completed mutations missing from the exact mutation manifest")
    write_mutation_manifest(args.mutation_manifest, plan_fingerprint, mutation_records)
    results: Counter[str] = Counter()
    failures: list[dict[str, str]] = []

    def process(kind: str, identity: str, callback: Any) -> None:
        key = f"{kind}:{identity}"
        if key in completed:
            if key not in mutation_records:
                raise RuntimeError(f"Resumed cutover mutation lacks manifest evidence: {key}")
            results[f"{kind}.resumed"] += 1
            return
        try:
            result = callback()
            if not isinstance(result, dict) or text(result.get("outcome")) not in {"created", "updated"}:
                raise RuntimeError("Cutover mutation returned an invalid outcome")
            outcome = text(result["outcome"])
            results[f"{kind}.{outcome}"] += 1
            mutation_records[key] = {
                "key": key,
                "kind": kind,
                "identity": identity,
                "outcome": outcome,
                "documentId": text(result.get("documentId")),
                "publicationState": text(result.get("publicationState")),
                "beforeUpdatedAt": text(result.get("beforeUpdatedAt")),
                "afterUpdatedAt": text(result.get("afterUpdatedAt")),
                "beforeFingerprint": text(result.get("beforeFingerprint")),
                "afterFingerprint": text(result.get("afterFingerprint")),
                "recordedAt": datetime.now(timezone.utc).isoformat(),
            }
            if "publicMediaEvidence" in result:
                evidence = result.get("publicMediaEvidence")
                if kind != "media" or not isinstance(evidence, dict):
                    raise RuntimeError("Cutover mutation returned misplaced or invalid public media evidence")
                mutation_records[key]["publicMediaEvidence"] = dict(evidence)
            write_mutation_manifest(args.mutation_manifest, plan_fingerprint, mutation_records)
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
        def apply_media(record: MediaRecord = record) -> dict[str, Any]:
            checksum = ""
            size = record.size_bytes or 0
            if args.copy_media and record.visibility == "public" and record.exists:
                checksum, size = copy_public_media(record, args.restricted_media_root, args.public_media_root)
            effective_visibility = "private" if record.attachment_id in metadata_only_media_ids else record.visibility
            data = {
                "title": record.title,
                "slug": slugify(record.title, f"media-{record.attachment_id}"),
                "assetType": "audio" if record.mime_type.startswith("audio/") else "image" if record.mime_type.startswith("image/") else "document",
                "visibility": effective_visibility,
                "sourceUrl": record.source_url,
                "legacyAttachmentId": record.attachment_id,
                "legacyRelativePath": record.relative_path,
                "publicPath": media_public_paths.get(record.attachment_id, ""),
                "mimeType": record.mime_type,
                "fileSizeBytes": size or None,
                "checksumSha256": checksum,
                "usageNotes": ", ".join((*record.referenced_by, *(('not public: unavailable or explicitly reviewed for reference removal',) if record.attachment_id in metadata_only_media_ids else ()))),
            }
            result = client.upsert("media-assets", "legacyAttachmentId", record.attachment_id, data)
            if checksum:
                result["publicMediaEvidence"] = {
                    "relativePath": record.relative_path,
                    "publicPath": f"/media/legacy/{record.relative_path}",
                    "sha256": checksum,
                    "sizeBytes": size,
                }
            return result
        process("media", record.attachment_id, apply_media)
    for redirect in redirects:
        process(
            "redirect",
            text(redirect.get("fromPath")),
            lambda redirect=redirect: client.upsert(
                "redirects",
                "fromPath",
                text(redirect["fromPath"]),
                {**redirect, "active": False},
                False,
            ),
        )

    public_media_evidence: dict[str, Any] = {}
    if not failures:
        try:
            public_media_evidence = verify_phase1_public_media_evidence(
                media_records,
                mutation_records,
                args.public_media_root,
            )
        except Exception as error:
            failures.append({"kind": "public-media-evidence", "identity": "phase-one", "error": str(error)[:1200]})
            results["public-media-evidence.failed"] += 1

    write_json(args.failure_report, {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "planFingerprint": plan_fingerprint,
        "failures": failures,
    })
    if failures:
        raise RuntimeError(f"Cutover apply completed with {len(failures)} failures; see {args.failure_report}")
    final_results: dict[str, Any] = dict(sorted(results.items()))
    final_results["mutationManifest"] = str(args.mutation_manifest)
    final_results["mutationManifestRecords"] = len(mutation_records)
    final_results["mutationManifestSha256"] = sha256_file(args.mutation_manifest)
    final_results["publicMediaEvidence"] = public_media_evidence
    return final_results


def expected_cutover_entries(plan: dict[str, Any], payloads: dict[str, Any]) -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}

    def add(
        kind: str,
        identity: str,
        api_path: str,
        identity_field: str,
        entity_type: str,
        *,
        action: str,
        exclusion_reason: str = "",
    ) -> None:
        key = f"{kind}:{identity}"
        if not identity or key in entries:
            raise RuntimeError(f"Cutover plan contains an invalid or duplicate mutation identity: {key}")
        entries[key] = {
            "key": key,
            "kind": kind,
            "identity": identity,
            "apiPath": api_path,
            "identityField": identity_field,
            "entityType": entity_type,
            "action": action,
            "exclusionReason": exclusion_reason,
        }

    for record in payloads["pages"]:
        add("page", text(record.get("pageKey")), "pages", "pageKey", "page", action="publish")
    for record in payloads["posts"]:
        add("post", text(record.get("legacyId")), "posts", "legacyId", "post", action="publish")

    missing_episode_ids = {
        text(record.get("trackId"))
        for record in plan.get("missingEpisodeMedia", [])
        if isinstance(record, dict) and text(record.get("trackId"))
    }
    for record in payloads["episodes"]:
        identity = text(record.get("trackId"))
        metadata_only = identity in missing_episode_ids or text(record.get("archiveReason")).startswith("CUTOVER_METADATA_ONLY:")
        add(
            "episode",
            identity,
            "episodes",
            "trackId",
            "episode",
            action="exclude" if metadata_only else "publish",
            exclusion_reason="missing-or-unverified-public-audio" if metadata_only else "",
        )
    for record in payloads["people"]:
        add("person", text(record.get("legacyId")), "people", "legacyId", "person", action="publish")
    for record in payloads["endorsements"]:
        add("endorsement", text(record.get("legacyId")), "endorsements", "legacyId", "endorsement", action="publish")

    metadata_only_media_ids = payloads["metadataOnlyMediaIds"]
    media_public_paths = payloads["mediaPublicPaths"]
    for record in payloads["media"]:
        identity = record.attachment_id
        has_verified_replacement = bool(public_episode_track_id_from_url(text(media_public_paths.get(identity))))
        eligible = (
            record.visibility == "public"
            and identity not in metadata_only_media_ids
            and (record.exists or has_verified_replacement)
        )
        if eligible:
            reason = ""
        elif record.visibility != "public":
            reason = "private-or-internal-media"
        else:
            reason = "missing-or-unverified-public-media"
        add(
            "media",
            identity,
            "media-assets",
            "legacyAttachmentId",
            "media-asset",
            action="publish" if eligible else "exclude",
            exclusion_reason=reason,
        )
    for record in payloads["redirects"]:
        add("redirect", text(record.get("fromPath")), "redirects", "fromPath", "redirect", action="activate")
    return entries


def load_publication_manifest(
    path: Path,
    plan_fingerprint: str,
    mutation_manifest_sha256: str,
    public_media_verification: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], str]:
    if not path.exists():
        return {}, "complete"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Cutover publication manifest is invalid: {error}") from error
    if (
        not isinstance(value, dict)
        or value.get("version") != 1
        or value.get("planFingerprint") != plan_fingerprint
        or value.get("mutationManifestSha256") != mutation_manifest_sha256
        or value.get("publicMediaVerification") != public_media_verification
    ):
        raise RuntimeError("Cutover publication manifest does not match the reviewed plan and mutation manifest")
    actions = value.get("actions")
    if not isinstance(actions, list) or any(not isinstance(item, dict) for item in actions):
        raise RuntimeError("Cutover publication evidence is invalid")
    records: dict[str, dict[str, Any]] = {}
    for expected_sequence, action in enumerate(actions, start=1):
        key = text(action.get("key"))
        if (
            not key
            or key in records
            or text(action.get("action")) not in {"published", "activated"}
            or action.get("sequence") != expected_sequence
            or not text(action.get("recordedAt"))
        ):
            raise RuntimeError("Cutover publication evidence contains an invalid or duplicate action")
        records[key] = dict(action)
    actions_fingerprint = stable_fingerprint(actions)
    invalidation = value.get("cacheInvalidation")
    if invalidation is None:
        return records, "pending" if records else "complete"
    if (
        not isinstance(invalidation, dict)
        or invalidation.get("state") not in {"pending", "complete"}
        or invalidation.get("actionsFingerprint") != actions_fingerprint
        or not text(invalidation.get("updatedAt"))
    ):
        raise RuntimeError("Cutover publication cache-invalidation evidence is invalid")
    return records, text(invalidation.get("state"))


def write_publication_manifest(
    path: Path,
    plan_fingerprint: str,
    mutation_manifest_sha256: str,
    public_media_verification: dict[str, Any],
    actions: dict[str, dict[str, Any]],
    exclusions: list[dict[str, str]],
    cache_invalidation_state: str,
) -> None:
    if cache_invalidation_state not in {"pending", "complete"}:
        raise RuntimeError("Cutover publication cache-invalidation state is invalid")
    ordered_actions = sorted(actions.values(), key=lambda action: int(action.get("sequence") or 0))
    if [action.get("sequence") for action in ordered_actions] != list(range(1, len(ordered_actions) + 1)):
        raise RuntimeError("Cutover publication action sequence is incomplete")
    write_json(path, {
        "version": 1,
        "planFingerprint": plan_fingerprint,
        "mutationManifestSha256": mutation_manifest_sha256,
        "publicMediaVerification": public_media_verification,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "actions": ordered_actions,
        "exclusions": exclusions,
        "cacheInvalidation": {
            "state": cache_invalidation_state,
            "actionsFingerprint": stable_fingerprint(ordered_actions),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        },
    })


def publish_reviewed_plan(
    args: argparse.Namespace,
    plan: dict[str, Any],
    payloads: dict[str, Any],
) -> dict[str, Any]:
    if args.confirm_publish_reviewed != PUBLISH_REVIEWED_CONFIRMATION:
        raise RuntimeError(
            f"--publish-reviewed requires --confirm-publish-reviewed {PUBLISH_REVIEWED_CONFIRMATION}"
        )
    if args.no_resume:
        raise RuntimeError("Publication evidence cannot be discarded; --no-resume is not valid with --publish-reviewed")

    plan_fingerprint = text(payloads.get("planFingerprint"))
    expected_entries = expected_cutover_entries(plan, payloads)
    mutation_manifest_sha256 = sha256_file(args.mutation_manifest)
    if (
        not re.fullmatch(r"[a-f0-9]{64}", text(args.reviewed_mutation_manifest_sha256))
        or text(args.reviewed_mutation_manifest_sha256) != mutation_manifest_sha256
    ):
        raise RuntimeError("Reviewed publication requires the exact independently confirmed phase-one mutation manifest SHA-256")
    mutation_records = load_mutation_manifest(args.mutation_manifest, plan_fingerprint)
    if set(mutation_records) != set(expected_entries):
        missing = sorted(set(expected_entries) - set(mutation_records))[:20]
        unexpected = sorted(set(mutation_records) - set(expected_entries))[:20]
        raise RuntimeError(
            f"Reviewed publication requires a complete exact draft mutation manifest; missing={missing}, unexpected={unexpected}"
        )
    completed_checkpoint = load_checkpoint(args.checkpoint, plan_fingerprint)
    if completed_checkpoint != set(expected_entries):
        raise RuntimeError("Reviewed publication refuses a partial draft checkpoint")
    try:
        failure_evidence = json.loads(args.failure_report.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Reviewed publication requires the exact draft failure report: {error}") from error
    if (
        not isinstance(failure_evidence, dict)
        or failure_evidence.get("planFingerprint") != plan_fingerprint
        or failure_evidence.get("failures") != []
    ):
        raise RuntimeError("Reviewed publication refuses missing, stale, or nonempty draft failure evidence")

    for key, expected in expected_entries.items():
        mutation = mutation_records[key]
        expected_state = "not-publishable" if expected["kind"] == "redirect" else "draft"
        if (
            text(mutation.get("kind")) != expected["kind"]
            or text(mutation.get("identity")) != expected["identity"]
            or text(mutation.get("publicationState")) != expected_state
            or not text(mutation.get("documentId"))
            or not text(mutation.get("afterUpdatedAt"))
            or not re.fullmatch(r"[a-f0-9]{64}", text(mutation.get("afterFingerprint")))
        ):
            raise RuntimeError(f"Draft mutation evidence drifted for {key}")

    public_media_verification = verify_phase1_public_media_evidence(
        payloads["media"],
        mutation_records,
        args.public_media_root,
    )
    publication_actions, cache_invalidation_state = load_publication_manifest(
        args.publication_manifest,
        plan_fingerprint,
        mutation_manifest_sha256,
        public_media_verification,
    )
    if set(publication_actions) - set(expected_entries):
        raise RuntimeError("Publication evidence contains an action outside the reviewed cutover plan")
    expected_publish_keys = {key for key, entry in expected_entries.items() if entry["action"] == "publish"}
    expected_redirect_keys = {key for key, entry in expected_entries.items() if entry["action"] == "activate"}
    recorded_redirect_keys = {
        key for key, record in publication_actions.items() if text(record.get("action")) == "activated"
    }
    if recorded_redirect_keys and not expected_publish_keys.issubset(publication_actions):
        raise RuntimeError("Cutover publication evidence shows redirect activation before all reviewed publications")
    exclusions = [
        {
            "key": key,
            "kind": text(entry["kind"]),
            "identity": text(entry["identity"]),
            "reason": text(entry["exclusionReason"]),
        }
        for key, entry in sorted(expected_entries.items())
        if entry["action"] == "exclude"
    ]
    revalidation_secret = canonical_cache_revalidation_secret(payloads["env"])

    def persist_publication_manifest() -> None:
        write_publication_manifest(
            args.publication_manifest,
            plan_fingerprint,
            mutation_manifest_sha256,
            public_media_verification,
            publication_actions,
            exclusions,
            cache_invalidation_state,
        )

    def mark_cache_invalidation_pending() -> None:
        nonlocal cache_invalidation_state
        cache_invalidation_state = "pending"
        persist_publication_manifest()

    def flush_cache_invalidation() -> None:
        nonlocal cache_invalidation_state
        if cache_invalidation_state != "pending":
            return
        request_public_cache_invalidation(revalidation_secret)
        cache_invalidation_state = "complete"
        persist_publication_manifest()

    persist_publication_manifest()
    if cache_invalidation_state == "pending":
        try:
            flush_cache_invalidation()
        except RuntimeError as error:
            raise RuntimeError(
                "Public cache invalidation remains pending; refusing new reviewed publication"
            ) from error

    client = canonical_strapi_client(payloads["env"])
    by_collection: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in expected_entries.values():
        by_collection[text(entry["apiPath"])].append(entry)

    current_by_key: dict[str, dict[str, Any]] = {}
    published_by_key: dict[str, dict[str, Any]] = {}
    for api_path, collection_entries in sorted(by_collection.items()):
        is_redirect = api_path == "redirects"
        draft_records = client.list_collection(api_path, status=None if is_redirect else "draft")
        identity_field = text(collection_entries[0]["identityField"])
        indexed: dict[str, dict[str, Any]] = {}
        for record in draft_records:
            identity = text(record.get(identity_field))
            if identity in indexed:
                raise RuntimeError(f"Current Strapi {api_path} identities are duplicated: {identity}")
            if identity:
                indexed[identity] = record
        for entry in collection_entries:
            current = indexed.get(text(entry["identity"]))
            if not current:
                raise RuntimeError(f"Reviewed draft is missing from Strapi: {entry['key']}")
            mutation = mutation_records[text(entry["key"])]
            if text(current.get("documentId")) != text(mutation.get("documentId")):
                raise RuntimeError(f"Reviewed draft document identity drifted: {entry['key']}")
            current_by_key[text(entry["key"])] = current

        if not is_redirect:
            published_records = client.list_collection(api_path, status="published")
            published_index = {
                text(record.get(identity_field)): record
                for record in published_records
                if text(record.get(identity_field))
            }
            for entry in collection_entries:
                if text(entry["key"]) in publication_actions:
                    published = published_index.get(text(entry["identity"]))
                    if not published or text(published.get("documentId")) != text(mutation_records[text(entry["key"])].get("documentId")):
                        raise RuntimeError(f"Recorded publication is not present in Strapi: {entry['key']}")
                    published_by_key[text(entry["key"])] = published

    for key, entry in sorted(expected_entries.items()):
        current = current_by_key[key]
        mutation = mutation_records[key]
        recorded = publication_actions.get(key)
        if recorded:
            expected_action = "activated" if entry["action"] == "activate" else "published"
            if text(recorded.get("action")) != expected_action:
                raise RuntimeError(f"Publication action evidence drifted: {key}")
            if entry["action"] == "activate" and current.get("active") is not True:
                raise RuntimeError(f"Recorded redirect activation is no longer active: {key}")
            continue
        if text(current.get("updatedAt")) != text(mutation.get("afterUpdatedAt")):
            raise RuntimeError(f"Reviewed draft changed after import; refusing publication: {key}")
        if entry["action"] == "activate" and current.get("active") is not False:
            raise RuntimeError(f"Redirect became active before reviewed activation: {key}")
        if entry["kind"] == "episode":
            metadata_only = text(current.get("archiveReason")).startswith("CUTOVER_METADATA_ONLY:")
            if entry["action"] == "publish" and (metadata_only or not text(current.get("externalAudioUrl"))):
                raise RuntimeError(f"Reviewed episode has missing or unverified audio: {key}")
            if entry["action"] == "exclude" and not metadata_only:
                raise RuntimeError(f"Metadata-only episode safety marker drifted: {key}")
        if entry["kind"] == "media":
            if entry["action"] == "publish":
                public_path = text(current.get("publicPath"))
                verified_file = (
                    public_path.startswith("/media/legacy/")
                    and re.fullmatch(r"[a-f0-9]{64}", text(current.get("checksumSha256")))
                    and int(current.get("fileSizeBytes") or 0) > 0
                )
                verified_replacement = bool(public_episode_track_id_from_url(public_path))
                if current.get("visibility") != "public" or not (verified_file or verified_replacement):
                    raise RuntimeError(f"Reviewed media is inactive, private, or unverified: {key}")
            elif current.get("visibility") == "public":
                raise RuntimeError(f"Excluded media unexpectedly became public: {key}")

    publish_entries = [
        entry
        for _key, entry in sorted(expected_entries.items())
        if entry["action"] == "publish" and text(entry["key"]) not in publication_actions
    ]
    for entry in publish_entries:
        key = text(entry["key"])
        current = current_by_key[key]
        mark_cache_invalidation_pending()
        after = client.publish_reviewed(
            text(entry["entityType"]),
            text(current.get("documentId")),
            text(current.get("updatedAt")),
        )
        publication_actions[key] = {
            "key": key,
            "kind": text(entry["kind"]),
            "identity": text(entry["identity"]),
            "action": "published",
            "documentId": text(after.get("documentId")),
            "beforeUpdatedAt": text(current.get("updatedAt")),
            "afterUpdatedAt": text(after.get("updatedAt")),
            "recordedAt": datetime.now(timezone.utc).isoformat(),
            "sequence": len(publication_actions) + 1,
        }
        persist_publication_manifest()

    if not expected_publish_keys.issubset(publication_actions):
        raise RuntimeError("Redirect activation refuses a partial reviewed publication phase")

    activate_entries = [
        entry
        for _key, entry in sorted(expected_entries.items())
        if entry["action"] == "activate" and text(entry["key"]) not in publication_actions
    ]
    for entry in activate_entries:
        key = text(entry["key"])
        current = current_by_key[key]
        mark_cache_invalidation_pending()
        after = client.activate_reviewed_redirect(
            text(current.get("documentId")),
            text(current.get("updatedAt")),
        )
        publication_actions[key] = {
            "key": key,
            "kind": "redirect",
            "identity": text(entry["identity"]),
            "action": "activated",
            "documentId": text(after.get("documentId")),
            "beforeUpdatedAt": text(current.get("updatedAt")),
            "afterUpdatedAt": text(after.get("updatedAt")),
            "recordedAt": datetime.now(timezone.utc).isoformat(),
            "sequence": len(publication_actions) + 1,
        }
        current_by_key[key] = after
        persist_publication_manifest()

    if cache_invalidation_state == "pending":
        try:
            flush_cache_invalidation()
        except RuntimeError as error:
            raise RuntimeError(
                "Reviewed publication was recorded; public cache invalidation remains pending"
            ) from error

    actionable_keys = expected_publish_keys | expected_redirect_keys
    if set(publication_actions) != actionable_keys:
        raise RuntimeError("Cutover attestation refuses an incomplete reviewed publication phase")
    verified_redirect_keys = {
        key
        for key in expected_redirect_keys
        if current_by_key.get(key, {}).get("active") is True
        and text(publication_actions.get(key, {}).get("action")) == "activated"
    }
    attestation = build_cutover_attestation(
        plan_fingerprint=plan_fingerprint,
        mutation_manifest_sha256=mutation_manifest_sha256,
        expected_entries=expected_entries,
        publication_actions=publication_actions,
        publication_manifest=args.publication_manifest,
        cache_invalidation_state=cache_invalidation_state,
        verified_redirect_keys=verified_redirect_keys,
        failure_evidence=failure_evidence,
        git_revision=deployed_git_revision(),
    )
    attestation_sha256 = write_cutover_attestation_pair(attestation)

    return {
        "publicationManifest": str(args.publication_manifest),
        "publicMediaVerification": public_media_verification,
        "published": sum(1 for record in publication_actions.values() if record.get("action") == "published"),
        "redirectsActivated": sum(1 for record in publication_actions.values() if record.get("action") == "activated"),
        "excludedDrafts": len(exclusions),
        "cutoverAttestation": str(DEFAULT_CUTOVER_ATTESTATION),
        "cutoverAttestationSha256": attestation_sha256,
    }


def build_plan(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    env_values = load_canonical_aic_env(args.env_file)
    rest_wp_content, rest_attachments, rest_snapshot_evidence = load_wordpress_rest_snapshot(
        args.wordpress_rest_snapshot,
        args.wordpress_rest_checksum,
    )
    if args.wordpress_source == "direct-database-refresh":
        database_wp_content, database_attachments = fetch_wordpress_direct_refresh(args)
        database_attachment_ids = {text(row.get("id")) for row in database_attachments}
        inaccessible_media_ids = {text(row.get("id")) for row in rest_snapshot_evidence.get("inaccessibleMedia", [])}
        if not inaccessible_media_ids.issubset(database_attachment_ids):
            raise RuntimeError("A REST-inaccessible media ID is missing from the trusted database baseline")
        rest_snapshot_evidence["inaccessibleMediaPreservedFromDatabase"] = sorted(inaccessible_media_ids, key=int)
        wp_content, attachments, wordpress_merge_report = merge_wordpress_sources(
            database_wp_content,
            database_attachments,
            rest_wp_content,
            rest_attachments,
        )
        rest_snapshot_evidence.update(wordpress_merge_report)
        rest_snapshot_evidence["sourceMode"] = "direct-database-refresh-plus-verified-snapshot"
        rest_media_increment_ids: Sequence[str] | None = rest_snapshot_evidence.get("restOnlyMediaIds", [])
        episode_identity_baseline = database_wp_content
    else:
        if args.confirm_wordpress_refresh:
            raise RuntimeError("--confirm-wordpress-refresh is only valid with direct-database-refresh mode")
        wp_content = rest_wp_content
        attachments = rest_attachments
        inaccessible_media_ids = sorted(
            (text(row.get("id")) for row in rest_snapshot_evidence.get("inaccessibleMedia", [])),
            key=int,
        )
        rest_snapshot_evidence.update({
            "sourceMode": "verified-snapshot-only",
            "snapshotContent": len(rest_wp_content),
            "snapshotReturnedMedia": len(rest_attachments),
            "snapshotDeclaredMedia": rest_snapshot_evidence.get("totals", {}).get("media"),
            "inaccessibleMediaDisposition": [
                {
                    "id": media_id,
                    "disposition": "excluded-rest-forbidden-no-public-record",
                }
                for media_id in inaccessible_media_ids
            ],
            "mergedContent": len(rest_wp_content),
            "mergedMedia": rest_snapshot_evidence.get("totals", {}).get("media"),
        })
        rest_media_increment_ids = None
        episode_identity_baseline = rest_wp_content
    aic_episodes, aic_posts = fetch_aic()
    episode_audio_inventory = fetch_episode_audio_inventory(args.mc_bin, args.mc_audio_target) if args.verify_episode_audio else {}
    episode_audio_object_ids = set(episode_audio_inventory)
    legacy_public_urls = read_manifest_urls(args.legacy_urls)
    legacy_urls = list(dict.fromkeys([
        *legacy_public_urls,
        *(text(row.get("sourceUrl")) for row in rest_wp_content if text(row.get("sourceUrl"))),
        *(text(row.get("sourceUrl")) for row in rest_attachments if text(row.get("sourceUrl"))),
    ]))
    attachment_urls = list(dict.fromkeys([
        *read_manifest_urls(args.attachment_manifest),
        *(text(row.get("sourceUrl")) for row in rest_attachments if text(row.get("sourceUrl"))),
    ]))
    raw_rejected_upload_references: list[dict[str, str]] = []
    raw_upload_references = extract_upload_references(
        [*wp_content, *aic_posts],
        raw_rejected_upload_references,
    )
    reviewed_media_dispositions, approved_reference_removals = load_reviewed_media_dispositions(
        args.reviewed_media_dispositions,
        text(rest_snapshot_evidence.get("sha256")),
        args.apply or args.publish_reviewed,
    )
    external_image_references = extract_external_image_references(rest_wp_content)
    external_image_backup_verification, external_image_paths, external_media_records = verify_external_image_backup_manifest(
        args.external_image_backup_manifest,
        text(rest_snapshot_evidence.get("sha256")),
        external_image_references,
        args.restricted_media_root,
    )
    pages, excluded_pages = build_pages(wp_content, external_image_paths)
    collapsed_aic_posts: list[dict[str, Any]] = []
    aic_post_reconciliation: list[dict[str, str]] = []
    posts = build_posts(wp_content, aic_posts, collapsed_aic_posts, aic_post_reconciliation, external_image_paths)
    episode_reconciliation: list[dict[str, str]] = []
    episode_audio_deduplication: dict[str, Any] = {}
    episodes, matches = build_episodes(
        wp_content,
        aic_episodes,
        episode_reconciliation,
        args.restricted_media_root,
        args.verify_media,
        episode_audio_deduplication,
        episode_identity_baseline,
    )
    excluded_endorsements: list[dict[str, str]] = []
    structured_content_coverage: dict[str, Any] = {}
    people, endorsements = build_people_and_endorsements(
        wp_content,
        excluded_endorsements,
        structured_content_coverage,
    )
    rejected_upload_references: list[dict[str, str]] = []
    final_payload_groups = {
        "page": pages,
        "post": posts,
        "episode": episodes,
        "person": people,
        "endorsement": endorsements,
    }
    localize_final_payload_uploads(final_payload_groups)
    pre_removal_payload_fingerprint = stable_fingerprint(final_payload_groups)
    upload_references = extract_final_payload_upload_references(
        final_payload_groups,
        rejected_upload_references,
    )
    raw_media_reference_inventory = build_raw_media_reference_inventory(
        raw_upload_references,
        upload_references,
        raw_rejected_upload_references,
    )
    media_records, rejected_media = build_media_records(
        attachments,
        attachment_urls,
        legacy_public_urls,
        upload_references,
        args.restricted_media_root,
        args.verify_media,
    )
    media_records = merge_external_media_records(media_records, external_media_records)
    missing_episode_media = reconcile_episode_media(episodes, media_records)
    aic_track_ids = {
        text(row.get("trackId"))
        for row in aic_episodes
        if PUBLIC_EPISODE_TRACK_ID_PATTERN.fullmatch(text(row.get("trackId")))
    }
    wordpress_sermons_by_id = {
        text(row.get("id")): row
        for row in wp_content
        if text(row.get("type")) == "wpfc_sermon"
    }
    matched_tracks_by_audio_path: defaultdict[str, list[str]] = defaultdict(list)
    for match in matches:
        relative_audio = sermon_audio_relative(wordpress_sermons_by_id.get(match.wp_sermon_id, {}))
        if relative_audio:
            matched_tracks_by_audio_path[relative_audio].append(match.aic_track_id)
    episodes_by_track_id = {text(row.get("trackId")): row for row in episodes}
    sermon_alias_targets: dict[str, str] = {}
    for row in episode_reconciliation:
        if text(row.get("status")) not in {"duplicate-aic", "duplicate-wordpress"}:
            continue
        canonical_track_id = text(row.get("canonicalTrackId"))
        if not canonical_track_id:
            canonical_wp_id = text(row.get("canonicalWpSermonId"))
            canonical_track_id = f"wp-sermon:{canonical_wp_id}" if canonical_wp_id else ""
        canonical_episode = episodes_by_track_id.get(canonical_track_id)
        if canonical_episode:
            sermon_alias_targets[text(row.get("wpSermonId"))] = f"/radio/{text(canonical_episode.get('slug'))}/"
    missing_public_media_disposition: list[dict[str, Any]] = []
    replacement_media_targets: dict[str, str] = {}
    for record in media_records:
        if record.visibility != "public" or record.exists:
            continue
        replacement_track_ids = sorted(set(matched_tracks_by_audio_path.get(record.relative_path, [])))
        object_id = replacement_track_ids[0] if replacement_track_ids else ""
        replacement_verified = (
            record.relative_path.casefold().endswith(".mp3")
            and object_id in aic_track_ids
            and episode_audio_inventory.get(object_id, 0) > 0
        )
        if replacement_verified:
            replacement_url = public_episode_media_url(object_id)
            replacement_media_targets[record.relative_path] = replacement_url
            disposition = "served-by-verified-aic-audio-object"
        elif record.relative_path in approved_reference_removals:
            replacement_url = ""
            disposition = "reviewed-remove-public-reference"
        else:
            replacement_url = ""
            disposition = "blocking-missing-public-media"
        missing_public_media_disposition.append({
            "legacyAttachmentId": record.attachment_id,
            "relativePath": record.relative_path,
            "disposition": disposition,
            "replacementUrl": replacement_url,
        })
    media_public_paths = {
        record.attachment_id: f"/media/legacy/{record.relative_path}"
        for record in media_records
        if record.visibility == "public" and record.exists
    }
    media_public_paths.update({
        text(row.get("legacyAttachmentId")): text(row.get("replacementUrl"))
        for row in missing_public_media_disposition
        if text(row.get("replacementUrl"))
    })
    metadata_only_media_ids = {
        text(row.get("legacyAttachmentId"))
        for row in missing_public_media_disposition
        if text(row.get("disposition")) in {
            "blocking-missing-public-media",
            "reviewed-remove-public-reference",
        }
    }
    media_reference_coverage = build_media_reference_coverage(
        upload_references,
        media_records,
        replacement_media_targets,
        approved_reference_removals,
        text(reviewed_media_dispositions.get("finalPayloadFingerprint")),
        pre_removal_payload_fingerprint,
        rejected_upload_references,
        args.verify_media,
    )
    applied_reference_removals = {
        text(record.get("relativePath"))
        for record in media_reference_coverage["records"]
        if text(record.get("disposition")) == "reviewed-reference-removal"
    }
    apply_verified_media_replacements(
        (pages, posts, episodes, people, endorsements),
        replacement_media_targets,
        applied_reference_removals,
    )
    final_media_target_audit = audit_final_public_media_targets(
        final_payload_groups,
        media_records,
        args.verify_media,
        {track_id for track_id, size in episode_audio_inventory.items() if size > 0},
    )
    rest_media_backup_verification = verify_rest_media_backup_manifest(
        args.rest_media_backup_manifest,
        text(rest_snapshot_evidence.get("sha256")),
        rest_media_increment_ids,
        args.restricted_media_root,
    )
    redirects, redirect_failures, unmatched_redirects = build_redirects(
        legacy_urls,
        wp_content,
        posts,
        episodes,
        media_records,
        replacement_media_targets,
        sermon_alias_targets,
    )
    plan_fingerprint = stable_fingerprint({
        "pages": pages,
        "posts": posts,
        "episodes": episodes,
        "people": people,
        "endorsements": endorsements,
        "media": [media_manifest_entry(record) for record in media_records],
        "redirects": redirects,
        "mediaPublicPaths": media_public_paths,
        "metadataOnlyMediaIds": sorted(metadata_only_media_ids),
        "mediaReferenceCoverage": media_reference_coverage,
        "reviewedMediaDispositions": reviewed_media_dispositions,
        "rawMediaReferenceInventory": raw_media_reference_inventory,
        "finalMediaTargetAudit": final_media_target_audit,
    })
    wp_counts = Counter(text(row.get("type")) for row in wp_content)
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
    people_without_photo_source = [
        {"legacyId": text(person.get("legacyId")), "name": text(person.get("name"))}
        for person in people
        if not text(person.get("legacyPhotoUrl"))
    ]
    people_with_unverified_photo = [
        {
            "legacyId": text(person.get("legacyId")),
            "name": text(person.get("name")),
            "legacyPhotoUrl": text(person.get("legacyPhotoUrl")),
        }
        for person in people
        if text(person.get("legacyPhotoUrl")) and text(person.get("legacyPhotoUrl")) not in verified_public_media_targets
    ]
    plan = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "apply" if args.apply else "publish-reviewed" if args.publish_reviewed else "dry-run",
        "planFingerprint": plan_fingerprint,
        "precedence": {
            "posts": "AIC pastorwood_posts supersede WordPress posts by legacy id, then source URL",
            "episodes": "AIC episodes are canonical; WordPress sermons enrich one AIC episode each by audio basename, then normalized title plus date; genuinely unique unmatched WordPress sermons are imported, while duplicate leftovers are reported without creating another episode",
            "media": "WordPress uploads require an explicit attachment manifest or verified published-content derivative; external Mailchimp images require an exact immutable backup manifest; published-content reference is required for public visibility",
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
        "wordpressRestSnapshot": rest_snapshot_evidence,
        "wordpressRestMediaBackup": rest_media_backup_verification,
        "externalImageBackup": external_image_backup_verification,
        "reviewedMediaDispositions": reviewed_media_dispositions,
        "rawMediaReferenceInventory": raw_media_reference_inventory,
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
            "wordpressOnlyRows": [row for row in aic_post_reconciliation if row.get("status") == "wordpress-only-preserved"],
        },
        "episodeReconciliation": {
            "counts": dict(sorted(episode_reconciliation_counts.items())),
            "aliasRedirects": len(sermon_alias_targets),
            "records": episode_reconciliation,
        },
        "episodeAudioDeduplication": episode_audio_deduplication,
        "redirectReasons": dict(sorted(redirect_counts.items())),
        "excludedPages": excluded_pages,
        "excludedEndorsements": excluded_endorsements,
        "structuredContentCoverage": structured_content_coverage,
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
            "checksums": "computed during phase-one copy and rehashed from mutation evidence before phase-two publication",
        },
        "mediaReferenceCoverage": media_reference_coverage,
        "finalMediaTargetAudit": final_media_target_audit,
        "peopleMediaCoverage": {
            "people": len(people),
            "verifiedPublicPhotos": len(people) - len(people_without_photo_source) - len(people_with_unverified_photo),
            "withoutPhotoSource": people_without_photo_source,
            "unverifiedPhotoSource": people_with_unverified_photo,
        },
        "episodeAudioCoverage": {
            "enabled": args.verify_episode_audio,
            "aicTrackIds": len(aic_track_ids),
            "numericTrackIds": sum(1 for track_id in aic_track_ids if track_id.isdigit()),
            "sermonAudioTrackIds": sum(1 for track_id in aic_track_ids if track_id.startswith("sa_")),
            "objects": len(episode_audio_object_ids) if args.verify_episode_audio else None,
            "totalBytes": sum(episode_audio_inventory.values()) if args.verify_episode_audio else None,
            "zeroByteObjectIds": sorted(object_id for object_id, size in episode_audio_inventory.items() if size == 0),
            "invalidObjectIds": sorted(
                object_id for object_id in episode_audio_object_ids
                if not PUBLIC_EPISODE_TRACK_ID_PATTERN.fullmatch(object_id)
            ),
            "found": len(aic_track_ids & episode_audio_object_ids) if args.verify_episode_audio else None,
            "missing": sorted(aic_track_ids - episode_audio_object_ids) if args.verify_episode_audio else [],
            "orphanObjects": sorted(episode_audio_object_ids - aic_track_ids) if args.verify_episode_audio else [],
        },
        "missingEpisodeMedia": missing_episode_media,
        "missingPublicMedia": missing_public_media,
        "missingPublicMediaDisposition": {
            "counts": dict(sorted(Counter(text(row.get("disposition")) for row in missing_public_media_disposition).items())),
            "records": missing_public_media_disposition,
        },
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
        "mediaPublicPaths": media_public_paths,
        "metadataOnlyMediaIds": metadata_only_media_ids,
    }
    return plan, payloads


def validate_apply_preflight(plan: dict[str, Any]) -> None:
    validate_media_reference_coverage(plan.get("mediaReferenceCoverage", {}))
    validate_final_public_media_targets(plan.get("finalMediaTargetAudit", {}))
    coverage = plan.get("episodeAudioCoverage", {})
    if (
        not coverage.get("enabled")
        or coverage.get("objects") != coverage.get("aicTrackIds")
        or coverage.get("missing")
        or coverage.get("orphanObjects")
        or coverage.get("zeroByteObjectIds")
        or coverage.get("invalidObjectIds")
    ):
        raise RuntimeError("Apply preflight failed: MinIO episode inventory is not an exact, nonzero AIC identity match")
    snapshot = plan.get("wordpressRestSnapshot", {})
    if snapshot.get("consistencyPasses") != 2 or not re.fullmatch(r"[a-f0-9]{64}", text(snapshot.get("sha256"))):
        raise RuntimeError("Apply preflight failed: immutable WordPress REST snapshot evidence is invalid")
    if snapshot.get("sourceMode") == "verified-snapshot-only":
        totals = snapshot.get("totals", {})
        returned_totals = snapshot.get("returnedTotals", {})
        inaccessible = snapshot.get("inaccessibleMedia", [])
        dispositions = snapshot.get("inaccessibleMediaDisposition", [])
        if (
            not isinstance(totals, dict)
            or not isinstance(returned_totals, dict)
            or totals.get("media") != returned_totals.get("media", 0) + len(inaccessible)
            or len(dispositions) != len(inaccessible)
            or any(text(row.get("disposition")) != "excluded-rest-forbidden-no-public-record" for row in dispositions)
        ):
            raise RuntimeError("Apply preflight failed: snapshot-inaccessible media is not explicitly dispositioned")
    backup = plan.get("wordpressRestMediaBackup", {})
    expected_backup_files = (
        len(backup.get("verifiedMediaIds", []))
        if snapshot.get("sourceMode") == "verified-snapshot-only"
        else len(snapshot.get("restOnlyMediaIds", []))
    )
    if not backup.get("enabled") or backup.get("missingMediaIds") or backup.get("verifiedFiles") != expected_backup_files:
        raise RuntimeError("Apply preflight failed: REST-only media backup is incomplete")
    external_backup = plan.get("externalImageBackup", {})
    if (
        not external_backup.get("enabled")
        or external_backup.get("missingSourceUrls")
        or external_backup.get("verifiedFiles") != external_backup.get("expectedFiles")
        or external_backup.get("verifiedReferences") != external_backup.get("expectedReferences")
    ):
        raise RuntimeError("Apply preflight failed: external legacy image backup is incomplete")
    deduplication = plan.get("episodeAudioDeduplication", {})
    if not deduplication.get("enabled"):
        raise RuntimeError("Apply preflight failed: canonical-root episode content hashing was not enabled")
    redirect_integrity = plan.get("redirectIntegrity", {})
    if any(redirect_integrity.get(key) for key in ("selfLoops", "reservedSources", "nonexistentMediaTargets")) or plan.get("redirectFailures"):
        raise RuntimeError("Apply preflight failed: redirect integrity checks did not pass")
    structured_coverage = plan.get("structuredContentCoverage", {})
    if not isinstance(structured_coverage, dict):
        raise RuntimeError("Apply preflight failed: structured extraction coverage is invalid")
    for key in ("people", "endorsements"):
        coverage_entry = structured_coverage.get(key, {})
        if not isinstance(coverage_entry, dict):
            raise RuntimeError(f"Apply preflight failed: {key} structured extraction coverage is invalid")
        records = coverage_entry.get("records", [])
        counts = Counter(text(record.get("status")) for record in records if isinstance(record, dict)) if isinstance(records, list) else Counter()
        if (
            not isinstance(records, list)
            or coverage_entry.get("encountered") != len(records)
            or coverage_entry.get("encountered", 0) <= 0
            or coverage_entry.get("imported") != counts["imported"]
            or coverage_entry.get("deduplicated") != counts["deduplicated"]
            or coverage_entry.get("excluded") != counts["excluded"]
            or coverage_entry.get("imported") != plan.get("plannedCounts", {}).get(key)
            or coverage_entry.get("encountered") != counts["imported"] + counts["deduplicated"] + counts["excluded"]
            or coverage_entry.get("blockingExclusions")
        ):
            raise RuntimeError(f"Apply preflight failed: {key} structured extraction coverage is incomplete")
    if structured_coverage["endorsements"].get("excluded") != len(plan.get("excludedEndorsements", [])):
        raise RuntimeError("Apply preflight failed: endorsement exclusions are not fully reported")
    people_media = plan.get("peopleMediaCoverage", {})
    if (
        people_media.get("people") != plan.get("plannedCounts", {}).get("people")
        or people_media.get("verifiedPublicPhotos") != people_media.get("people")
        or people_media.get("withoutPhotoSource")
        or people_media.get("unverifiedPhotoSource")
    ):
        raise RuntimeError("Apply preflight failed: an imported board portrait is not a verified public legacy asset")
    reconciliation = plan.get("episodeReconciliation", {})
    reconciliation_counts = reconciliation.get("counts", {})
    expected_aliases = int(reconciliation_counts.get("duplicate-aic", 0)) + int(reconciliation_counts.get("duplicate-wordpress", 0))
    if reconciliation.get("aliasRedirects") != expected_aliases:
        raise RuntimeError("Apply preflight failed: a discarded sermon lacks a canonical redirect alias")
    dispositions = plan.get("missingPublicMediaDisposition", {})
    disposition_records = dispositions.get("records", [])
    reviewed_removal_paths = {
        text(row.get("relativePath"))
        for row in plan.get("reviewedMediaDispositions", {}).get("records", [])
        if isinstance(row, dict) and text(row.get("action")) == "remove-public-reference"
    }
    if len(disposition_records) != len(plan.get("missingPublicMedia", [])) or any(
        not (
            (
                text(row.get("disposition")) == "served-by-verified-aic-audio-object"
                and public_episode_track_id_from_url(text(row.get("replacementUrl")))
            )
            or (
                text(row.get("disposition")) == "reviewed-remove-public-reference"
                and text(row.get("relativePath")) in reviewed_removal_paths
                and not text(row.get("replacementUrl"))
            )
        )
        for row in disposition_records
    ):
        raise RuntimeError("Apply preflight failed: missing public media lacks a verified replacement or reviewed removal")


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.apply and args.publish_reviewed:
            raise ValueError("--apply and --publish-reviewed are separate phases and cannot run together")
        if args.apply and not (args.verify_media and args.verify_episode_audio and args.copy_media):
            raise ValueError("--apply requires --verify-media --verify-episode-audio --copy-media")
        if args.publish_reviewed and not (args.verify_media and args.verify_episode_audio):
            raise ValueError("--publish-reviewed requires --verify-media --verify-episode-audio")
        if args.publish_reviewed and not re.fullmatch(r"[a-f0-9]{64}", text(args.reviewed_mutation_manifest_sha256)):
            raise ValueError("--publish-reviewed requires --reviewed-mutation-manifest-sha256 with the exact phase-one SHA-256")
        plan, payloads = build_plan(args)
        if args.plan_output:
            write_json(args.plan_output, plan)
        if args.redirect_output:
            write_json(args.redirect_output, payloads["redirects"])
        if args.media_output:
            write_json(args.media_output, [media_manifest_entry(record) for record in payloads["media"] if record.visibility == "public" and record.exists])
        if args.apply:
            validate_apply_preflight(plan)
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
                payloads["mediaPublicPaths"],
                payloads["metadataOnlyMediaIds"],
            )
            if args.plan_output:
                write_json(args.plan_output, plan)
        elif args.publish_reviewed:
            validate_apply_preflight(plan)
            plan["publicationResults"] = publish_reviewed_plan(args, plan, payloads)
            if args.plan_output:
                write_json(args.plan_output, plan)
        print(json.dumps(plan, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except Exception as error:
        print(f"pastorwood cutover failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
