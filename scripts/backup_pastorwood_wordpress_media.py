#!/usr/bin/env python3
"""Back up REST-only PastorWood media into the canonical restricted archive."""

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
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from pastorwood_cutover_import import (
    DEFAULT_RESTRICTED_MEDIA_ROOT,
    file_sha256,
    load_wordpress_rest_snapshot,
    safe_upload_relative_path,
    text,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--snapshot-checksum", type=Path)
    parser.add_argument("--plan", type=Path, required=True, help="Dry-run plan that identifies REST-only media IDs")
    parser.add_argument("--destination-root", type=Path, default=DEFAULT_RESTRICTED_MEDIA_ROOT)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--max-files", type=int, default=100)
    parser.add_argument("--max-file-bytes", type=int, default=2 * 1024 * 1024 * 1024)
    parser.add_argument("--max-total-bytes", type=int, default=10 * 1024 * 1024 * 1024)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--retries", type=int, default=4)
    return parser.parse_args()


def validate_source_url(value: str) -> tuple[str, str]:
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or parsed.hostname != "www.pastorwood.org" or parsed.port not in {None, 443}:
        raise ValueError("Media source must use the canonical PastorWood HTTPS host")
    if parsed.username or parsed.password or not parsed.path.startswith("/wp-content/uploads/"):
        raise ValueError("Media source is outside the canonical uploads path")
    relative = safe_upload_relative_path(value)
    if not relative:
        raise ValueError("Media source has an unsafe uploads-relative path")
    return urllib.parse.urlunsplit(("https", "www.pastorwood.org", parsed.path, "", "")), relative


def safe_destination(root: Path, relative: str) -> Path:
    root_resolved = root.resolve(strict=True)
    if root_resolved != DEFAULT_RESTRICTED_MEDIA_ROOT.resolve(strict=True):
        raise RuntimeError("Media backup destination must be the canonical restricted uploads root")
    destination = root_resolved.joinpath(*PurePosixPath(relative).parts)
    current = root_resolved
    for part in PurePosixPath(relative).parts[:-1]:
        current = current / part
        if current.exists() and (current.is_symlink() or not current.is_dir()):
            raise RuntimeError(f"Unsafe destination parent: {current}")
        current.mkdir(mode=0o755, exist_ok=True)
    if destination.is_symlink() or (destination.exists() and not destination.is_file()):
        raise RuntimeError(f"Unsafe destination file: {destination}")
    return destination


def open_with_retries(url: str, timeout: float, retries: int):
    last_error: Exception | None = None
    for attempt in range(retries):
        request = urllib.request.Request(url, headers={"Accept": "application/octet-stream", "User-Agent": "PastorWood-cutover-media-backup/1.0"})
        try:
            response = urllib.request.urlopen(request, timeout=timeout)
            final = urllib.parse.urlsplit(response.geturl())
            if final.scheme != "https" or final.hostname != "www.pastorwood.org" or not final.path.startswith("/wp-content/uploads/"):
                response.close()
                raise RuntimeError("Media download redirected outside the canonical uploads host/path")
            return response
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
            last_error = error
            retryable = not isinstance(error, urllib.error.HTTPError) or error.code in {408, 429, 500, 502, 503, 504}
            if not retryable or attempt + 1 >= retries:
                break
            time.sleep(min(4.0, 0.5 * (2 ** attempt)))
    raise RuntimeError(f"Media download failed after {retries} attempts: {last_error}")


def stream_download(response: BinaryIO, output: BinaryIO, max_file_bytes: int) -> tuple[int, str]:
    declared = response.headers.get("Content-Length")
    if declared and int(declared) > max_file_bytes:
        raise RuntimeError("Media file exceeds the per-file byte limit")
    digest = hashlib.sha256()
    size = 0
    while True:
        chunk = response.read(1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > max_file_bytes:
            raise RuntimeError("Media file exceeds the per-file byte limit")
        digest.update(chunk)
        output.write(chunk)
    if declared and size != int(declared):
        raise RuntimeError("Media download length did not match Content-Length")
    return size, digest.hexdigest()


def write_manifest_new(path: Path, value: dict) -> None:
    if path.exists():
        raise RuntimeError("Refusing to overwrite an existing media backup manifest")
    payload = (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
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
        raise RuntimeError("Refusing to overwrite an existing media backup manifest") from error
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    args = parse_args()
    if min(args.max_files, args.max_file_bytes, args.max_total_bytes, args.retries) < 1 or args.timeout <= 0:
        raise ValueError("Backup bounds must be positive")
    _content, attachments, snapshot_evidence = load_wordpress_rest_snapshot(args.snapshot, args.snapshot_checksum)
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    plan_snapshot = plan.get("wordpressRestSnapshot") if isinstance(plan, dict) else None
    if not isinstance(plan_snapshot, dict) or plan_snapshot.get("sha256") != snapshot_evidence["sha256"]:
        raise RuntimeError("Plan does not bind to the supplied WordPress REST snapshot")
    requested_ids = plan_snapshot.get("restOnlyMediaIds")
    if not isinstance(requested_ids, list) or any(not text(item).isdigit() for item in requested_ids):
        raise RuntimeError("Plan REST-only media IDs are invalid")
    requested_ids = [text(item) for item in requested_ids]
    if len(requested_ids) > args.max_files:
        raise RuntimeError("REST-only media exceeds the configured file-count bound")
    attachment_by_id = {text(row.get("id")): row for row in attachments}
    if any(item_id not in attachment_by_id for item_id in requested_ids):
        raise RuntimeError("Plan references media not present in the immutable snapshot")

    records: list[dict[str, object]] = []
    total_bytes = 0
    for item_id in requested_ids:
        attachment = attachment_by_id[item_id]
        source_url, relative = validate_source_url(text(attachment.get("sourceUrl")))
        destination = safe_destination(args.destination_root, relative)
        with open_with_retries(source_url, args.timeout, args.retries) as response:
            with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=f".{destination.name}.", delete=False) as handle:
                temporary = Path(handle.name)
                try:
                    size_bytes, digest = stream_download(response, handle, args.max_file_bytes)
                    handle.flush()
                    os.fsync(handle.fileno())
                except Exception:
                    temporary.unlink(missing_ok=True)
                    raise
        total_bytes += size_bytes
        if total_bytes > args.max_total_bytes:
            temporary.unlink(missing_ok=True)
            raise RuntimeError("REST-only media exceeds the configured total-byte bound")
        os.chmod(temporary, 0o640)
        if destination.exists():
            existing_digest = file_sha256(destination)
            existing_size = destination.stat().st_size
            temporary.unlink(missing_ok=True)
            if existing_digest != digest or existing_size != size_bytes:
                raise RuntimeError(f"Refusing to overwrite mismatched existing media: {relative}")
            status = "verified-existing-identical"
        else:
            try:
                os.link(temporary, destination)
            except FileExistsError as error:
                raise RuntimeError(f"Destination appeared during backup; refusing overwrite: {relative}") from error
            finally:
                temporary.unlink(missing_ok=True)
            status = "created"
        records.append({
            "id": item_id,
            "sourceUrl": source_url,
            "relativePath": relative,
            "destination": str(destination),
            "sizeBytes": size_bytes,
            "sha256": digest,
            "status": status,
        })

    manifest = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "snapshotSha256": snapshot_evidence["sha256"],
        "destinationRoot": str(DEFAULT_RESTRICTED_MEDIA_ROOT),
        "fileCount": len(records),
        "totalBytes": total_bytes,
        "records": records,
    }
    write_manifest_new(args.manifest, manifest)
    print(json.dumps({"manifest": str(args.manifest), "fileCount": len(records), "totalBytes": total_bytes}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
