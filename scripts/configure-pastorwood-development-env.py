#!/usr/bin/env python3
"""Safely pin the canonical AIC environment to PastorWood development gates."""

from __future__ import annotations

import fcntl
import os
import pwd
import secrets
import stat
import sys
import time
from pathlib import Path


CONFIRMATION = "CONFIGURE_PASTORWOOD_DEVELOPMENT"
CANONICAL_ENV = "/mnt/storage/aic/.env"
CANONICAL_LOCK = "/run/lock/aic-strapi-env-sync.lock"
TEST_ROOT_PREFIX = os.path.join(
    os.path.realpath("/tmp"),
    "aic-pastorwood-development-env-test-",
)

MANAGED_VALUES = {
    "PASTORWOOD_LAUNCH_STAGE": "development",
    "PASTORWOOD_PUBLIC_URL": "https://aic.ammonsfarm.org",
    "PASTORWOOD_ALLOW_INDEXING": "false",
    "PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED": "false",
    "PASTORWOOD_SUBSCRIPTIONS_ENABLED": "false",
}
DATABASE_KEYS = ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD")
ROUTING_KEYS = (
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
    "DATABASE_URL",
)
SENSITIVE_KEYS = frozenset((*MANAGED_VALUES, *DATABASE_KEYS, *ROUTING_KEYS))


class ConfigurationError(RuntimeError):
    """A safe, non-secret-bearing configuration failure."""


def fail(message: str) -> None:
    raise ConfigurationError(message)


def is_within(path: str, root: str) -> bool:
    try:
        return os.path.commonpath((path, root)) == root and path != root
    except ValueError:
        return False


def require_test_path(raw_path: str, root: str, label: str) -> str:
    if not raw_path:
        fail(f"Test mode requires an explicit {label} path.")
    absolute = os.path.abspath(raw_path)
    resolved_parent = os.path.realpath(os.path.dirname(absolute))
    if resolved_parent != root and not is_within(resolved_parent, root):
        fail(f"The {label} test path must stay inside the isolated test root.")
    return os.path.join(resolved_parent, os.path.basename(absolute))


def runtime_paths() -> tuple[str, str, int, int, int, int, str | None, str | None]:
    test_mode = os.environ.get("PASTORWOOD_DEVELOPMENT_ENV_TEST_MODE", "0")
    if test_mode not in {"0", "1"}:
        fail("PASTORWOOD_DEVELOPMENT_ENV_TEST_MODE must be 0 or 1.")

    if test_mode == "0":
        if os.geteuid() != 0:
            fail("Run the PastorWood development environment configurator as root.")
        account = pwd.getpwnam("ammonsfarm")
        return CANONICAL_ENV, CANONICAL_LOCK, account.pw_uid, account.pw_gid, 0, 0, None, None

    if os.environ.get("NODE_ENV") != "test":
        fail("The PastorWood development environment test escape requires NODE_ENV=test.")
    raw_root = os.environ.get("PASTORWOOD_DEVELOPMENT_ENV_TEST_ROOT", "")
    if not raw_root:
        fail("Test mode requires an isolated test root.")
    try:
        root_lstat = os.lstat(raw_root)
    except OSError as error:
        raise ConfigurationError("The isolated test root is unavailable.") from error
    if stat.S_ISLNK(root_lstat.st_mode) or not stat.S_ISDIR(root_lstat.st_mode):
        fail("The isolated test root must be a real directory, not a symlink.")
    if root_lstat.st_uid != os.getuid():
        fail("The isolated test root must be owned by the test user.")
    test_root = os.path.realpath(raw_root)
    if not test_root.startswith(TEST_ROOT_PREFIX):
        fail("The isolated test root must use its dedicated /tmp prefix.")

    env_path = require_test_path(
        os.environ.get("PASTORWOOD_DEVELOPMENT_ENV_TEST_ENV_FILE", ""),
        test_root,
        "environment",
    )
    lock_path = require_test_path(
        os.environ.get("PASTORWOOD_DEVELOPMENT_ENV_TEST_LOCK_FILE", ""),
        test_root,
        "lock",
    )
    ready_raw = os.environ.get("PASTORWOOD_DEVELOPMENT_ENV_TEST_READY_FILE", "")
    release_raw = os.environ.get("PASTORWOOD_DEVELOPMENT_ENV_TEST_RELEASE_FILE", "")
    if bool(ready_raw) != bool(release_raw):
        fail("Test lock coordination requires both ready and release paths.")
    ready_path = require_test_path(ready_raw, test_root, "ready") if ready_raw else None
    release_path = require_test_path(release_raw, test_root, "release") if release_raw else None
    return (
        env_path,
        lock_path,
        root_lstat.st_uid,
        root_lstat.st_gid,
        root_lstat.st_uid,
        root_lstat.st_gid,
        ready_path,
        release_path,
    )


def open_lock(path: str, expected_uid: int, expected_gid: int) -> int:
    flags = os.O_RDWR | os.O_CREAT | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags, 0o600)
    except OSError as error:
        raise ConfigurationError("Refusing an unsafe PastorWood environment lock path.") from error
    metadata = os.fstat(descriptor)
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != expected_uid
        or metadata.st_gid != expected_gid
        or stat.S_IMODE(metadata.st_mode) != 0o600
    ):
        os.close(descriptor)
        fail("PastorWood environment lock has an unexpected type, owner, or mode.")
    return descriptor


def coordinate_test_lock(ready_path: str | None, release_path: str | None) -> None:
    if not ready_path or not release_path:
        return
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        ready_fd = os.open(ready_path, flags, 0o600)
        os.write(ready_fd, b"ready\n")
        os.fsync(ready_fd)
        os.close(ready_fd)
    except OSError as error:
        raise ConfigurationError("Could not create the isolated test ready marker.") from error

    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        try:
            metadata = os.lstat(release_path)
        except FileNotFoundError:
            time.sleep(0.01)
            continue
        if stat.S_ISREG(metadata.st_mode) and not stat.S_ISLNK(metadata.st_mode):
            return
        fail("The isolated test release marker must be a regular file.")
    fail("Timed out waiting for the isolated test lock release.")


def parsed_key(raw_line: bytes) -> str | None:
    try:
        line = raw_line.decode("utf-8").strip()
    except UnicodeDecodeError as error:
        raise ConfigurationError("The canonical environment must be valid UTF-8.") from error
    if not line or line.startswith("#"):
        return None
    if line.startswith("export "):
        line = line.removeprefix("export ").lstrip()
    if "=" not in line:
        return None
    key = line.split("=", 1)[0].strip()
    return key or None


def parsed_value(raw_line: bytes) -> str:
    line = raw_line.decode("utf-8").strip()
    if line.startswith("export "):
        line = line.removeprefix("export ").lstrip()
    value = line.split("=", 1)[1].strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
    return value


def analyze(data: bytes) -> tuple[list[bytes], dict[str, list[bytes]], bytes]:
    if b"\0" in data:
        fail("The canonical environment contains an invalid NUL byte.")
    if data and not data.endswith((b"\n", b"\r")):
        fail("The canonical environment must end with a line separator.")
    lines = data.splitlines(keepends=True)
    occurrences: dict[str, list[bytes]] = {key: [] for key in SENSITIVE_KEYS}
    unmanaged: list[bytes] = []
    for raw_line in lines:
        key = parsed_key(raw_line)
        if key in SENSITIVE_KEYS:
            occurrences[key].append(raw_line)
        if key not in MANAGED_VALUES:
            unmanaged.append(raw_line)

    for key, values in occurrences.items():
        if len(values) > 1:
            fail(f"Canonical environment contains duplicate {key} entries.")
    for key in ROUTING_KEYS:
        if occurrences[key]:
            fail(f"Canonical environment contains forbidden database routing key {key}.")
    for key in DATABASE_KEYS:
        if len(occurrences[key]) != 1:
            fail(f"Canonical environment must contain exactly one {key} entry.")
    if parsed_value(occurrences["DB_HOST"][0]) != "192.168.1.106":
        fail("Canonical AIC PostgreSQL must remain at 192.168.1.106:5432.")
    if parsed_value(occurrences["DB_PORT"][0]) != "5432":
        fail("Canonical AIC PostgreSQL must remain at 192.168.1.106:5432.")
    return lines, occurrences, b"".join(unmanaged)


def replacement_line(key: str, original: bytes | None) -> bytes:
    ending = b"\n"
    if original is not None:
        if original.endswith(b"\r\n"):
            ending = b"\r\n"
        elif original.endswith(b"\r"):
            ending = b"\r"
        elif original.endswith(b"\n"):
            ending = b"\n"
    return f"{key}={MANAGED_VALUES[key]}".encode("utf-8") + ending


def candidate_bytes(data: bytes) -> tuple[bytes, tuple[bytes, ...], bytes]:
    lines, occurrences, unmanaged = analyze(data)
    database_lines = tuple(occurrences[key][0] for key in DATABASE_KEYS)
    emitted: set[str] = set()
    candidate: list[bytes] = []
    for raw_line in lines:
        key = parsed_key(raw_line)
        if key in MANAGED_VALUES:
            candidate.append(replacement_line(key, raw_line))
            emitted.add(key)
        else:
            candidate.append(raw_line)
    for key in MANAGED_VALUES:
        if key not in emitted:
            candidate.append(replacement_line(key, None))
    return b"".join(candidate), database_lines, unmanaged


def read_regular_file(directory_fd: int, name: str) -> tuple[bytes, os.stat_result]:
    flags = os.O_RDONLY | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(name, flags, dir_fd=directory_fd)
    except OSError as error:
        raise ConfigurationError("The canonical AIC environment must be a regular file, not a symlink.") from error
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            fail("The canonical AIC environment must be a regular file, not a symlink.")
        chunks: list[bytes] = []
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        return b"".join(chunks), metadata
    finally:
        os.close(descriptor)


def atomic_replace(directory_fd: int, name: str, data: bytes, uid: int, gid: int) -> None:
    temporary_name = f".{name}.pastorwood-development.{os.getpid()}.{secrets.token_hex(8)}"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = -1
    try:
        descriptor = os.open(temporary_name, flags, 0o600, dir_fd=directory_fd)
        view = memoryview(data)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:
                fail("Could not write the canonical PastorWood environment safely.")
            view = view[written:]
        os.fchown(descriptor, uid, gid)
        os.fchmod(descriptor, 0o600)
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.replace(temporary_name, name, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
        os.fsync(directory_fd)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            os.unlink(temporary_name, dir_fd=directory_fd)
        except FileNotFoundError:
            pass


def verify_result(
    data: bytes,
    expected_database_lines: tuple[bytes, ...],
    expected_unmanaged: bytes,
    expected_uid: int,
    expected_gid: int,
    metadata: os.stat_result,
) -> None:
    _, occurrences, unmanaged = analyze(data)
    if tuple(occurrences[key][0] for key in DATABASE_KEYS) != expected_database_lines:
        fail("Database entries changed during PastorWood environment configuration.")
    if unmanaged != expected_unmanaged:
        fail("An unrelated environment entry changed during PastorWood environment configuration.")
    for key, expected in MANAGED_VALUES.items():
        if len(occurrences[key]) != 1 or parsed_value(occurrences[key][0]) != expected:
            fail("PastorWood development launch settings did not verify after the atomic write.")
    if (
        metadata.st_uid != expected_uid
        or metadata.st_gid != expected_gid
        or stat.S_IMODE(metadata.st_mode) != 0o600
    ):
        fail("Canonical AIC environment has an unexpected owner or mode after configuration.")


def configure() -> None:
    if sys.argv[1:] != [CONFIRMATION]:
        fail(f"Literal confirmation required: {CONFIRMATION}")
    (
        env_path,
        lock_path,
        target_uid,
        target_gid,
        lock_uid,
        lock_gid,
        ready_path,
        release_path,
    ) = runtime_paths()

    lock_fd = open_lock(lock_path, lock_uid, lock_gid)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        coordinate_test_lock(ready_path, release_path)

        directory = os.path.dirname(env_path)
        name = os.path.basename(env_path)
        directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            directory_flags |= os.O_NOFOLLOW
        try:
            directory_fd = os.open(directory, directory_flags)
        except OSError as error:
            raise ConfigurationError("The canonical AIC environment directory is unsafe or unavailable.") from error
        try:
            original, original_metadata = read_regular_file(directory_fd, name)
            candidate, database_lines, unmanaged = candidate_bytes(original)
            metadata_needs_repair = (
                original_metadata.st_uid != target_uid
                or original_metadata.st_gid != target_gid
                or stat.S_IMODE(original_metadata.st_mode) != 0o600
            )
            if candidate != original or metadata_needs_repair:
                atomic_replace(directory_fd, name, candidate, target_uid, target_gid)
            result, metadata = read_regular_file(directory_fd, name)
            verify_result(result, database_lines, unmanaged, target_uid, target_gid, metadata)
        finally:
            os.close(directory_fd)
    finally:
        os.close(lock_fd)

    print("PastorWood development launch settings are configured.")


if __name__ == "__main__":
    try:
        configure()
    except (ConfigurationError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None
