#!/usr/bin/env python3
"""Capture a bounded, consistency-checked PastorWood WordPress REST snapshot."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CANONICAL_ORIGIN = "https://www.pastorwood.org"
MAX_PAGE_BYTES = 32 * 1024 * 1024
FIELDS = {
    "pages": "id,date,date_gmt,modified,modified_gmt,slug,status,type,link,title,content,excerpt,parent,guid,featured_media",
    "posts": "id,date,date_gmt,modified,modified_gmt,slug,status,type,link,title,content,excerpt,parent,guid,categories,featured_media,meta",
    "sermons": "id,date,date_gmt,modified,modified_gmt,slug,status,type,link,title,content,excerpt,guid,featured_media,sermon_audio,sermon_audio_duration,sermon_date,bible_passage",
    "media": "id,date,date_gmt,modified,modified_gmt,slug,status,type,link,title,guid,post,source_url,mime_type,alt_text,media_details",
    "categories": "id,slug,name",
}
ENDPOINTS = {
    "pages": ("pages", {"status": "publish"}),
    "posts": ("posts", {"status": "publish"}),
    "sermons": ("wpfc_sermon", {"status": "publish"}),
    "media": ("media", {}),
    "categories": ("categories", {}),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", default=CANONICAL_ORIGIN)
    parser.add_argument("--output", type=Path, required=True, help="New versioned path; existing artifacts are never overwritten")
    parser.add_argument("--per-page", type=int, default=100)
    parser.add_argument("--max-pages", type=int, default=100)
    parser.add_argument("--max-records", type=int, default=10_000)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--expected-inaccessible-media-id", action="append", type=int, default=[], help="REST-forbidden media ID retained from the database baseline")
    return parser.parse_args()


def validate_origin(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or parsed.hostname != "www.pastorwood.org" or parsed.port not in {None, 443}:
        raise ValueError("Snapshot origin must be https://www.pastorwood.org")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Snapshot origin must not contain credentials, query, or fragment")
    return CANONICAL_ORIGIN


def bounded_request(url: str, timeout: float, retries: int) -> tuple[list[dict[str, Any]], int, int]:
    last_error: Exception | None = None
    for attempt in range(retries):
        request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "PastorWood-cutover-snapshot/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                final = urllib.parse.urlsplit(response.geturl())
                if final.scheme != "https" or final.hostname != "www.pastorwood.org":
                    raise RuntimeError("WordPress REST redirected outside the canonical host")
                declared = response.headers.get("Content-Length")
                if declared and int(declared) > MAX_PAGE_BYTES:
                    raise RuntimeError("WordPress REST page exceeds the byte limit")
                payload = response.read(MAX_PAGE_BYTES + 1)
                if len(payload) > MAX_PAGE_BYTES:
                    raise RuntimeError("WordPress REST page exceeds the byte limit")
                records = json.loads(payload)
                if not isinstance(records, list) or any(not isinstance(item, dict) for item in records):
                    raise RuntimeError("WordPress REST page is not an object array")
                return records, int(response.headers["X-WP-Total"]), int(response.headers["X-WP-TotalPages"])
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError) as error:
            last_error = error
            retryable = not isinstance(error, urllib.error.HTTPError) or error.code in {408, 429, 500, 502, 503, 504}
            if not retryable or attempt + 1 >= retries:
                break
            time.sleep(min(4.0, 0.5 * (2 ** attempt)))
    raise RuntimeError(f"WordPress REST request failed after {retries} attempts: {last_error}")


def capture_endpoint(
    origin: str,
    endpoint: str,
    extra_params: dict[str, str],
    fields: str,
    per_page: int,
    max_pages: int,
    max_records: int,
    timeout: float,
    retries: int,
    allowed_missing_count: int = 0,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    records: list[dict[str, Any]] = []
    expected_total: int | None = None
    expected_pages: int | None = None
    page = 1
    while True:
        params = {
            "per_page": str(per_page),
            "page": str(page),
            "orderby": "id",
            "order": "asc",
            "_fields": fields,
            **extra_params,
        }
        url = f"{origin}/wp-json/wp/v2/{endpoint}?{urllib.parse.urlencode(params)}"
        page_records, total, total_pages = bounded_request(url, timeout, retries)
        if expected_total is None:
            expected_total, expected_pages = total, total_pages
            if total > max_records or total_pages > max_pages:
                raise RuntimeError(f"{endpoint} exceeds configured snapshot bounds")
        if total != expected_total or total_pages != expected_pages:
            raise RuntimeError(f"{endpoint} totals changed during pagination")
        if len(page_records) > per_page:
            raise RuntimeError(f"{endpoint} returned more than the requested page size")
        records.extend(page_records)
        if page >= total_pages:
            break
        page += 1
    ids = [item.get("id") for item in records]
    if len(records) + allowed_missing_count != expected_total or any(not isinstance(item_id, int) for item_id in ids) or len(set(ids)) != len(ids):
        raise RuntimeError(
            f"{endpoint} record count or ID uniqueness validation failed "
            f"(records={len(records)}, total={expected_total}, uniqueIds={len(set(ids))})"
        )
    if ids != sorted(ids):
        raise RuntimeError(f"{endpoint} IDs are not stable ascending pagination")
    return records, {"total": expected_total, "returned": len(records), "inaccessible": allowed_missing_count, "pages": expected_pages, "perPage": per_page}


def verify_inaccessible_media_ids(origin: str, media_ids: list[int], timeout: float) -> list[dict[str, int | str]]:
    evidence: list[dict[str, int | str]] = []
    for media_id in sorted(set(media_ids)):
        url = f"{origin}/wp-json/wp/v2/media/{media_id}?_fields=id,status,type"
        request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "PastorWood-cutover-snapshot/1.0"})
        try:
            urllib.request.urlopen(request, timeout=timeout).close()
        except urllib.error.HTTPError as error:
            payload = error.read(4097)
            if error.code != 401 or len(payload) > 4096:
                raise RuntimeError(f"Expected media {media_id} is not a bounded REST-forbidden record") from error
            try:
                code = json.loads(payload).get("code")
            except (json.JSONDecodeError, AttributeError) as decode_error:
                raise RuntimeError(f"Expected media {media_id} returned invalid error JSON") from decode_error
            if code != "rest_forbidden":
                raise RuntimeError(f"Expected media {media_id} did not return rest_forbidden")
            evidence.append({"id": media_id, "httpStatus": 401, "code": "rest_forbidden"})
            continue
        raise RuntimeError(f"Expected media {media_id} unexpectedly became REST-readable")
    return evidence


def capture_pass(args: argparse.Namespace, origin: str) -> tuple[dict[str, list[dict[str, Any]]], dict[str, dict[str, int]]]:
    collections: dict[str, list[dict[str, Any]]] = {}
    totals: dict[str, dict[str, int]] = {}
    for name, (endpoint, params) in ENDPOINTS.items():
        records, metadata = capture_endpoint(
            origin,
            endpoint,
            params,
            FIELDS[name],
            args.per_page,
            args.max_pages,
            args.max_records,
            args.timeout,
            args.retries,
            len(set(args.expected_inaccessible_media_id)) if name == "media" else 0,
        )
        if name in {"pages", "posts", "sermons"} and any(item.get("status") != "publish" for item in records):
            raise RuntimeError(f"{name} snapshot contains a non-published record")
        collections[name] = records
        totals[name] = metadata
    return collections, totals


def canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def atomic_write_new(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o640)
    try:
        os.link(temporary, path)
    except FileExistsError as error:
        raise RuntimeError(f"Refusing to overwrite immutable snapshot artifact: {path}") from error
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    args = parse_args()
    if not 1 <= args.per_page <= 100 or args.max_pages < 1 or args.max_records < 1 or args.timeout <= 0 or args.retries < 1:
        raise ValueError("Snapshot bounds must be positive and per-page cannot exceed 100")
    if len(args.expected_inaccessible_media_id) != len(set(args.expected_inaccessible_media_id)):
        raise ValueError("Expected inaccessible media IDs must be unique")
    origin = validate_origin(args.origin)
    checksum_path = args.output.with_suffix(args.output.suffix + ".sha256")
    if args.output.exists() or checksum_path.exists():
        raise RuntimeError("Snapshot output already exists; choose a new versioned output path")
    first_collections, first_totals = capture_pass(args, origin)
    second_collections, second_totals = capture_pass(args, origin)
    if canonical_bytes(first_collections) != canonical_bytes(second_collections) or first_totals != second_totals:
        raise RuntimeError("WordPress REST changed between the two consistency passes; retry the capture")
    inaccessible_media = verify_inaccessible_media_ids(origin, args.expected_inaccessible_media_id, args.timeout)
    returned_media_ids = {item["id"] for item in first_collections["media"]}
    if any(item["id"] in returned_media_ids for item in inaccessible_media):
        raise RuntimeError("An expected inaccessible media ID also appeared in the collection")
    snapshot = {
        "schemaVersion": 1,
        "origin": origin,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "consistencyPasses": 2,
        "totals": first_totals,
        "inaccessibleMedia": inaccessible_media,
        "collections": first_collections,
    }
    payload = canonical_bytes(snapshot)
    digest = hashlib.sha256(payload).hexdigest()
    atomic_write_new(args.output, payload)
    atomic_write_new(checksum_path, f"{digest}  {args.output.name}\n".encode("ascii"))
    print(json.dumps({"snapshot": str(args.output), "checksum": str(checksum_path), "sha256": digest, "totals": first_totals}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
