#!/usr/bin/env python3
"""Validate the non-secret structure of the dedicated backup crypt remote."""

from __future__ import annotations

import configparser
import re
import sys
from pathlib import Path


REMOTE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$")
REMOTE_TARGET = re.compile(
    r"^(?P<remote>[A-Za-z0-9][A-Za-z0-9._-]{0,62}):(?P<path>[^\r\n]+)$"
)
ALLOWED_OFF_HOST_BACKEND_TYPES = {
    "azureblob",
    "b2",
    "box",
    "drive",
    "dropbox",
    "onedrive",
    "pcloud",
    "protondrive",
    "s3",
    "swift",
}


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    if len(sys.argv) != 3:
        fail("Usage: validate-rclone-crypt-config.py <config-path> <crypt-remote-name>")

    config_path = Path(sys.argv[1])
    crypt_remote = sys.argv[2]
    if not REMOTE_NAME.fullmatch(crypt_remote):
        fail("The rclone crypt remote name is invalid.")

    parser = configparser.RawConfigParser(interpolation=None, strict=True)
    parser.optionxform = str.lower
    try:
        with config_path.open("r", encoding="utf-8") as handle:
            parser.read_file(handle)
    except (OSError, UnicodeError, configparser.Error):
        fail("The dedicated rclone configuration cannot be parsed safely.")

    if not parser.has_section(crypt_remote):
        fail("The configured rclone crypt remote is absent.")
    crypt = parser[crypt_remote]
    if crypt.get("type", "").strip() != "crypt":
        fail("The configured backup remote must be an rclone crypt remote.")
    if not crypt.get("password", "").strip() or not crypt.get("password2", "").strip():
        fail("The crypt remote must have both a password and filename-encryption salt.")
    if crypt.get("filename_encryption", "standard").strip() != "standard":
        fail("The crypt remote must use standard filename encryption.")
    if crypt.get("directory_name_encryption", "true").strip().lower() != "true":
        fail("The crypt remote must encrypt directory names.")

    target = crypt.get("remote", "").strip()
    match = REMOTE_TARGET.fullmatch(target)
    if not match or not match.group("path").strip("/"):
        fail("The crypt remote must target a dedicated directory on a named backing remote.")
    backing_remote = match.group("remote")
    if backing_remote == crypt_remote or not parser.has_section(backing_remote):
        fail("The crypt remote backing remote is absent or recursive.")
    backing_type = parser[backing_remote].get("type", "").strip().lower()
    if backing_type not in ALLOWED_OFF_HOST_BACKEND_TYPES:
        fail("The crypt remote must use a direct off-host-capable backing provider.")

    print("Validated the dedicated encrypted rclone remote structure without exposing credentials.")


if __name__ == "__main__":
    main()
