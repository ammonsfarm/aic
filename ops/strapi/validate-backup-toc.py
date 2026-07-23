#!/usr/bin/env python3
"""Validate the offline TOC of one scoped AIC PostgreSQL archive."""

from __future__ import annotations

import re
import sys
from pathlib import Path


TOC_RELATION = re.compile(
    r"^\s*\d+;\s+\d+\s+\d+\s+"
    r"(?P<kind>TABLE DATA|SEQUENCE SET|TABLE|SEQUENCE)\s+"
    r"(?P<schema>\S+)\s+(?P<name>\S+)\s+"
)
EXPECTED_KINDS = ("TABLE", "TABLE DATA", "SEQUENCE", "SEQUENCE SET")


def fail(message: str) -> None:
    raise SystemExit(f"Backup TOC validation failed: {message}")


def load_inventory(path: Path) -> tuple[set[str], set[str]]:
    tables: set[str] = set()
    sequences: set[str] = set()
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        fail(f"object inventory could not be read: {error}")
    for line_number, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) != 2 or parts[0] not in {"table", "sequence"}:
            fail(f"invalid object inventory entry on line {line_number}")
        kind, qualified_name = parts
        if not re.fullmatch(r"public\.[a-z][a-z0-9_]{0,62}", qualified_name):
            fail(f"invalid public object name on line {line_number}")
        target = tables if kind == "table" else sequences
        if qualified_name in target:
            fail(f"duplicate object inventory entry: {qualified_name}")
        target.add(qualified_name)
    if len(tables) != 11 or len(sequences) != 6:
        fail("object inventory must contain exactly 11 tables and 6 sequences")
    return tables, sequences


def relation_entries(contents: str) -> dict[str, set[str]]:
    found = {kind: set() for kind in EXPECTED_KINDS}
    for raw_line in contents.splitlines():
        match = TOC_RELATION.match(raw_line)
        if not match:
            continue
        kind = match.group("kind")
        qualified_name = f"{match.group('schema')}.{match.group('name')}"
        if qualified_name in found[kind]:
            fail(f"duplicate {kind} entry: {qualified_name}")
        found[kind].add(qualified_name)
    return found


def validate_schema(contents: str) -> None:
    if not re.search(r"^\s*\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+aic_strapi\s+", contents, re.MULTILINE):
        fail("schema archive is missing SCHEMA - aic_strapi")
    for kind, names in relation_entries(contents).items():
        outside = sorted(name for name in names if not name.startswith("aic_strapi."))
        if outside:
            fail(f"schema archive contains {kind} outside aic_strapi: {', '.join(outside)}")


def validate_public(contents: str, tables: set[str], sequences: set[str]) -> None:
    found = relation_entries(contents)
    expected = {
        "TABLE": tables,
        "TABLE DATA": tables,
        "SEQUENCE": sequences,
        "SEQUENCE SET": sequences,
    }
    for kind in EXPECTED_KINDS:
        missing = sorted(expected[kind] - found[kind])
        unexpected = sorted(found[kind] - expected[kind])
        if missing or unexpected:
            fail(
                f"public archive {kind} inventory differs; "
                f"missing={','.join(missing) or 'none'}; "
                f"unexpected={','.join(unexpected) or 'none'}"
            )
    if re.search(r"^\s*\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+aic_strapi\s+", contents, re.MULTILINE):
        fail("public archive unexpectedly contains the aic_strapi schema")


def main(argv: list[str]) -> int:
    if len(argv) != 3 or argv[1] not in {"schema", "public"}:
        print(f"Usage: {argv[0]} schema|public TOC-LISTING", file=sys.stderr)
        return 2
    listing = Path(argv[2])
    inventory = Path(__file__).with_name("backup-object-inventory.txt")
    tables, sequences = load_inventory(inventory)
    try:
        contents = listing.read_text(encoding="utf-8")
    except OSError as error:
        fail(f"TOC listing could not be read: {error}")
    if not contents.strip():
        fail("TOC listing is empty")
    if argv[1] == "schema":
        validate_schema(contents)
    else:
        validate_public(contents, tables, sequences)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
