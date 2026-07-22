#!/usr/bin/env python3
"""Snapshot allowlisted legacy email images to same-origin canonical storage."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

from pastorwood_cutover_import import DEFAULT_RESTRICTED_MEDIA_ROOT, file_sha256, load_wordpress_rest_snapshot


ALLOWED_CONTENT_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
}


class ImageSourceParser(HTMLParser):
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


def allowed_host(hostname: str | None) -> bool:
    host = (hostname or "").casefold()
    return host == "gallery.mailchimp.com" or host == "mcusercontent.com" or host.endswith(".mcusercontent.com")


def validate_source_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or not allowed_host(parsed.hostname) or parsed.username or parsed.password or not parsed.path:
        raise ValueError("External image is outside the Mailchimp HTTPS allowlist")
    return urllib.parse.urlunsplit(("https", parsed.netloc, parsed.path, parsed.query, ""))


def extract_sources(snapshot: dict) -> dict[str, list[str]]:
    sources: dict[str, list[str]] = {}
    collections = snapshot.get("collections", {})
    for collection_name in ("pages", "posts", "sermons"):
        for row in collections.get(collection_name, []):
            content = row.get("content", {})
            parser = ImageSourceParser()
            parser.feed(content.get("rendered", "") if isinstance(content, dict) else "")
            for raw_source in parser.sources:
                parsed = urllib.parse.urlsplit(raw_source)
                if not allowed_host(parsed.hostname):
                    continue
                source = validate_source_url(raw_source)
                sources.setdefault(source, []).append(f"{collection_name}:{row.get('id')}")
    return sources


def download(source_url: str, timeout: float, retries: int, max_bytes: int) -> tuple[bytes, str]:
    last_error: Exception | None = None
    for attempt in range(retries):
        request = urllib.request.Request(source_url, headers={"Accept": "image/*", "User-Agent": "PastorWood-cutover-image-backup/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                final = urllib.parse.urlsplit(response.geturl())
                if final.scheme != "https" or not allowed_host(final.hostname):
                    raise RuntimeError("External image redirected outside the Mailchimp host allowlist")
                content_type = (response.headers.get_content_type() or "").casefold()
                if content_type not in ALLOWED_CONTENT_TYPES:
                    raise RuntimeError(f"External image returned unsupported content type: {content_type}")
                declared = response.headers.get("Content-Length")
                if declared and int(declared) > max_bytes:
                    raise RuntimeError("External image exceeds the byte limit")
                payload = response.read(max_bytes + 1)
                if len(payload) > max_bytes or (declared and len(payload) != int(declared)):
                    raise RuntimeError("External image exceeded or did not match the byte limit")
                return payload, content_type
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
            last_error = error
            retryable = not isinstance(error, urllib.error.HTTPError) or error.code in {408, 429, 500, 502, 503, 504}
            if not retryable or attempt + 1 >= retries:
                break
            time.sleep(min(4.0, 0.5 * (2 ** attempt)))
    raise RuntimeError(f"External image download failed after {retries} attempts: {last_error}")


def write_new(path: Path, payload: bytes, mode: int) -> None:
    if path.exists():
        raise RuntimeError(f"Refusing to overwrite immutable artifact: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, mode)
    try:
        os.link(temporary, path)
    except FileExistsError as error:
        raise RuntimeError(f"Refusing to overwrite immutable artifact: {path}") from error
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--snapshot-checksum", type=Path)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--max-images", type=int, default=20)
    parser.add_argument("--max-image-bytes", type=int, default=15 * 1024 * 1024)
    parser.add_argument("--max-total-bytes", type=int, default=100 * 1024 * 1024)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--retries", type=int, default=4)
    args = parser.parse_args()
    if min(args.max_images, args.max_image_bytes, args.max_total_bytes, args.retries) < 1 or args.timeout <= 0:
        raise ValueError("External image backup bounds must be positive")
    _content, _attachments, evidence = load_wordpress_rest_snapshot(args.snapshot, args.snapshot_checksum)
    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    sources = extract_sources(snapshot)
    if len(sources) > args.max_images:
        raise RuntimeError("External image count exceeds the configured bound")
    canonical_root = DEFAULT_RESTRICTED_MEDIA_ROOT.resolve(strict=True)
    destination_parent = canonical_root / "pastorwood-import" / "external-images"
    current = canonical_root
    for part in ("pastorwood-import", "external-images"):
        current = current / part
        if current.exists() and (current.is_symlink() or not current.is_dir()):
            raise RuntimeError("External image destination parent is unsafe")
        current.mkdir(mode=0o755, exist_ok=True)

    records = []
    total_bytes = 0
    for source_url, references in sorted(sources.items()):
        payload, content_type = download(source_url, args.timeout, args.retries, args.max_image_bytes)
        total_bytes += len(payload)
        if total_bytes > args.max_total_bytes:
            raise RuntimeError("External image total exceeds the configured bound")
        digest = hashlib.sha256(payload).hexdigest()
        relative_path = f"pastorwood-import/external-images/{hashlib.sha256(source_url.encode('utf-8')).hexdigest()}.{ALLOWED_CONTENT_TYPES[content_type]}"
        destination = canonical_root.joinpath(*relative_path.split("/"))
        if destination.exists():
            if destination.is_symlink() or destination.stat().st_size != len(payload) or file_sha256(destination) != digest:
                raise RuntimeError(f"Refusing to overwrite mismatched external image: {destination}")
            status = "verified-existing-identical"
        else:
            write_new(destination, payload, 0o640)
            status = "created"
        records.append({
            "sourceUrl": source_url,
            "relativePath": relative_path,
            "publicPath": f"/media/legacy/{relative_path}",
            "contentType": content_type,
            "sizeBytes": len(payload),
            "sha256": digest,
            "references": sorted(references),
            "status": status,
        })
    manifest = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "snapshotSha256": evidence["sha256"],
        "destinationRoot": str(DEFAULT_RESTRICTED_MEDIA_ROOT),
        "fileCount": len(records),
        "referenceCount": sum(len(row["references"]) for row in records),
        "totalBytes": total_bytes,
        "records": records,
    }
    write_new(args.manifest, (json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8"), 0o640)
    print(json.dumps({"manifest": str(args.manifest), "files": len(records), "references": manifest["referenceCount"], "bytes": total_bytes}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
