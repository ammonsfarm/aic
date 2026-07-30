#!/usr/bin/env python3
"""Recover recent failed episode intelligence from canonical cached assets."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
from typing import Any, Callable, Mapping, Sequence

import psycopg
from psycopg.rows import dict_row

try:
    from scripts.aic_database_env import (
        CANONICAL_AIC_ENV,
        CANONICAL_PODCAST_ENV,
        canonical_subprocess_env,
        database_dsn,
        load_canonical_aic_env,
        load_supplemental_podcast_env,
    )
except ModuleNotFoundError:  # Direct execution from /mnt/storage/aic/scripts.
    from aic_database_env import (
        CANONICAL_AIC_ENV,
        CANONICAL_PODCAST_ENV,
        canonical_subprocess_env,
        database_dsn,
        load_canonical_aic_env,
        load_supplemental_podcast_env,
    )


DEFAULT_PODCAST_ROOT = Path("/mnt/storage/aic_podcast")
DEFAULT_WEB_ROOT = Path("/mnt/storage/aic")
DEFAULT_AUDIO_DIR = Path("/mnt/storage/podcasts")
DEFAULT_TRANSCRIPT_CACHE = DEFAULT_PODCAST_ROOT / "transcript_cache"
DEFAULT_RECOVERY_TRANSCRIPTS = DEFAULT_PODCAST_ROOT / "intelligence_recovery_transcripts"
DEFAULT_PODCAST_PYTHON = DEFAULT_PODCAST_ROOT / ".venv-pg/bin/python"
DEFAULT_DAILY_RUNNER = DEFAULT_PODCAST_ROOT / "run_daily_podcast_ingest.py"
DEFAULT_MC_BIN = Path("/usr/local/bin/mc")
MINIO_ALIAS = "local-minio"
MINIO_BUCKET = "aic"
MINIO_PREFIX = "podcasts"
DEFAULT_LOOKBACK_DAYS = 14
MAX_LOOKBACK_DAYS = 31
DEFAULT_MAX_CANDIDATES = 4
MAX_CANDIDATES = 4
MAX_SCAN_ROWS = 20
MAX_TRANSCRIPT_BYTES = 100_000_000
MAX_AUDIO_BYTES = 250 * 1024 * 1024
MAX_RUNNER_ATTEMPTS = 1
RUNNER_TIMEOUT_SECONDS = 7_200
MC_TIMEOUT_SECONDS = 300
INTELLIGENCE_MODEL = "openai-codex/gpt-5.6-luna"
TRACK_ID_PATTERN = re.compile(
    r"(?:[0-9]+|sa_[0-9]+|wp-sermon:[0-9]+|cms_[a-z0-9][a-z0-9_-]{0,62})"
)


@dataclass(frozen=True)
class RuntimePaths:
    env_file: Path = CANONICAL_AIC_ENV
    podcast_env_file: Path = CANONICAL_PODCAST_ENV
    web_root: Path = DEFAULT_WEB_ROOT
    podcast_root: Path = DEFAULT_PODCAST_ROOT
    audio_dir: Path = DEFAULT_AUDIO_DIR
    transcript_cache: Path = DEFAULT_TRANSCRIPT_CACHE
    recovery_transcripts: Path = DEFAULT_RECOVERY_TRANSCRIPTS
    podcast_python: Path = DEFAULT_PODCAST_PYTHON
    daily_runner: Path = DEFAULT_DAILY_RUNNER
    mc_bin: Path = DEFAULT_MC_BIN


@dataclass(frozen=True)
class RecoveryCandidate:
    track_id: str
    publish_date: str
    status: str


@dataclass(frozen=True)
class MinioAudio:
    source: str
    size_bytes: int


@dataclass(frozen=True)
class OwnedFile:
    path: Path
    device: int
    inode: int


CommandRunner = Callable[..., subprocess.CompletedProcess[str]]


def text(value: Any) -> str:
    return str(value or "").strip()


def validate_track_id(value: Any) -> str:
    track_id = text(value)
    if len(track_id) > 100 or not TRACK_ID_PATTERN.fullmatch(track_id):
        raise RuntimeError(f"Intelligence recovery received an unsafe Track ID: {track_id or '[empty]'}")
    return track_id


def safe_output(value: str, limit: int = 2_000) -> str:
    redacted = re.sub(
        r"(?i)(authorization|cookie|password|secret|api[_-]?key|token)\s*[:=]\s*[^\s,;]+",
        r"\1=[redacted]",
        value,
    )
    return redacted[-limit:].strip()


def run_process(
    command: Sequence[str],
    *,
    cwd: Path,
    env: Mapping[str, str],
    timeout: int,
    runner: CommandRunner = subprocess.run,
) -> subprocess.CompletedProcess[str]:
    try:
        return runner(
            list(command),
            cwd=cwd,
            env=dict(env),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            shell=False,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"Fixed recovery command timed out after {timeout} seconds.") from error
    except OSError as error:
        raise RuntimeError(f"Could not start fixed recovery command: {type(error).__name__}.") from error


def validate_production_runtime(paths: RuntimePaths) -> None:
    expected = RuntimePaths()
    for field in RuntimePaths.__dataclass_fields__:
        actual = getattr(paths, field)
        required = getattr(expected, field)
        if actual != required:
            raise RuntimeError(f"Production intelligence recovery {field} must be {required}; got {actual}.")
    for label, path in {
        "canonical environment": paths.env_file,
        "supplemental environment": paths.podcast_env_file,
        "podcast runner": paths.daily_runner,
        "cached transcript root": paths.transcript_cache,
    }.items():
        if not path.exists() or path.is_symlink():
            raise RuntimeError(f"Production {label} is missing or unsafe: {path}")
    for label, path in {
        "podcast interpreter": paths.podcast_python,
        "MinIO client": paths.mc_bin,
    }.items():
        # Virtualenv interpreters are normally symlinks to their pinned Python
        # binary. The path itself remains fixed; only non-files/non-executables
        # are rejected here.
        if not path.is_file() or not os.access(path, os.X_OK):
            raise RuntimeError(f"Production {label} is missing or not executable: {path}")
    for label, path in {
        "podcast root": paths.podcast_root,
        "web root": paths.web_root,
        "audio staging root": paths.audio_dir,
    }.items():
        if not path.is_dir() or path.is_symlink():
            raise RuntimeError(f"Production {label} is missing or unsafe: {path}")


def select_recent_failed_intelligence(
    conn: Any,
    *,
    lookback_days: int,
    max_candidates: int,
) -> list[RecoveryCandidate]:
    if not 1 <= lookback_days <= MAX_LOOKBACK_DAYS:
        raise ValueError(f"lookback_days must be between 1 and {MAX_LOOKBACK_DAYS}")
    if not 1 <= max_candidates <= MAX_CANDIDATES:
        raise ValueError(f"max_candidates must be between 1 and {MAX_CANDIDATES}")
    rows = conn.execute(
        """
        select e.track_id, e.publish_date, i.status
          from episode_intelligence i
          join episodes e using (track_id)
         where i.status in ('failed', 'rate_limited')
           and (
                 i.updated_at >= now() - make_interval(days => %s)
                 or (
                      left(e.publish_date, 10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                      and left(e.publish_date, 10)::date >= current_date - %s
                    )
               )
         order by e.publish_date, e.track_id
         limit %s
        """,
        (lookback_days, lookback_days, MAX_SCAN_ROWS + 1),
    ).fetchall()
    if len(rows) > MAX_SCAN_ROWS:
        raise RuntimeError(f"Failed intelligence scan exceeded the safety bound of {MAX_SCAN_ROWS} rows.")
    candidates = [
        RecoveryCandidate(
            track_id=validate_track_id(row["track_id"]),
            publish_date=text(row.get("publish_date")),
            status=text(row.get("status")),
        )
        for row in rows
    ]
    if len(candidates) > max_candidates:
        raise RuntimeError(
            f"Recoverable intelligence rows ({len(candidates)}) exceed the candidate safety bound ({max_candidates})."
        )
    return candidates


def safe_child_path(root: Path, track_id: str, suffix: str) -> Path:
    validated = validate_track_id(track_id)
    if not root.is_dir() or root.is_symlink():
        raise RuntimeError(f"Recovery root is missing or unsafe: {root}")
    child = root / f"{validated}{suffix}"
    if child.parent != root:
        raise RuntimeError("Recovery path escaped its fixed root.")
    return child


def validate_cached_transcript(paths: RuntimePaths, track_id: str) -> Path:
    path = safe_child_path(paths.transcript_cache, track_id, ".json")
    try:
        metadata = path.lstat()
    except FileNotFoundError as error:
        raise RuntimeError(f"Recent failed intelligence {track_id} has no canonical cached transcript.") from error
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size <= 0 or metadata.st_size > MAX_TRANSCRIPT_BYTES:
        raise RuntimeError(f"Recent failed intelligence {track_id} has an unsafe cached transcript.")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Recent failed intelligence {track_id} has an invalid cached transcript.") from error
    if not isinstance(payload, dict):
        raise RuntimeError(f"Recent failed intelligence {track_id} has an invalid cached transcript.")
    return path


def minio_audio_source(track_id: str) -> str:
    return f"{MINIO_ALIAS}/{MINIO_BUCKET}/{MINIO_PREFIX}/{validate_track_id(track_id)}.mp3"


def stat_minio_audio(
    paths: RuntimePaths,
    track_id: str,
    env: Mapping[str, str],
    *,
    runner: CommandRunner = subprocess.run,
) -> MinioAudio:
    source = minio_audio_source(track_id)
    result = run_process(
        [str(paths.mc_bin), "stat", "--json", source],
        cwd=paths.podcast_root,
        env=env,
        timeout=MC_TIMEOUT_SECONDS,
        runner=runner,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Recent failed intelligence {track_id} has no verified canonical MinIO audio.")
    try:
        payload = json.loads(result.stdout.strip().splitlines()[-1])
        size_bytes = int(payload.get("size") or 0)
    except (IndexError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Canonical MinIO audio stat was invalid for {track_id}.") from error
    name = text(payload.get("name"))
    key = text(payload.get("key")).lstrip("/")
    expected_key = f"{MINIO_PREFIX}/{track_id}.mp3"
    if (
        (name != f"{track_id}.mp3" and key != expected_key)
        or size_bytes <= 0
        or size_bytes > MAX_AUDIO_BYTES
    ):
        raise RuntimeError(f"Canonical MinIO audio stat was invalid for {track_id}.")
    return MinioAudio(source=source, size_bytes=size_bytes)


def owned_file(path: Path) -> OwnedFile:
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode):
        raise RuntimeError(f"Recovery staged an unsafe non-regular file: {path}")
    return OwnedFile(path=path, device=metadata.st_dev, inode=metadata.st_ino)


def remove_owned_file(item: OwnedFile) -> None:
    try:
        metadata = item.path.lstat()
    except FileNotFoundError:
        return
    if stat.S_ISREG(metadata.st_mode) and metadata.st_dev == item.device and metadata.st_ino == item.inode:
        item.path.unlink()


def link_exclusive(temporary: Path, destination: Path) -> OwnedFile:
    if destination.exists() or destination.is_symlink():
        raise RuntimeError(f"Recovery staging destination already exists: {destination}")
    try:
        os.link(temporary, destination)
    except FileExistsError as error:
        raise RuntimeError(f"Recovery staging destination appeared concurrently: {destination}") from error
    return owned_file(destination)


def stage_audio(
    paths: RuntimePaths,
    candidate: RecoveryCandidate,
    audio: MinioAudio,
    env: Mapping[str, str],
    *,
    runner: CommandRunner = subprocess.run,
) -> OwnedFile:
    destination = safe_child_path(paths.audio_dir, candidate.track_id, ".mp3")
    temporary = destination.with_name(f".{destination.name}.{os.getpid()}.intelligence-recovery-tmp")
    if temporary.exists() or temporary.is_symlink():
        raise RuntimeError(f"Recovery temporary audio path already exists: {temporary}")
    try:
        result = run_process(
            [str(paths.mc_bin), "cp", "--preserve", audio.source, str(temporary)],
            cwd=paths.podcast_root,
            env=env,
            timeout=MC_TIMEOUT_SECONDS,
            runner=runner,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Could not stage canonical MinIO audio for {candidate.track_id}.")
        metadata = temporary.lstat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size != audio.size_bytes:
            raise RuntimeError(f"Staged canonical MinIO audio failed size verification for {candidate.track_id}.")
        return link_exclusive(temporary, destination)
    finally:
        if temporary.exists() and not temporary.is_symlink():
            temporary.unlink()


def ensure_recovery_transcript_root(paths: RuntimePaths) -> None:
    root = paths.recovery_transcripts
    if root.exists() or root.is_symlink():
        if not root.is_dir() or root.is_symlink():
            raise RuntimeError(f"Recovery transcript root is unsafe: {root}")
        return
    if root.parent != paths.podcast_root or paths.podcast_root.is_symlink():
        raise RuntimeError("Recovery transcript root escaped the fixed podcast workspace.")
    root.mkdir(mode=0o700)


def stage_transcript(paths: RuntimePaths, track_id: str, source: Path) -> OwnedFile:
    ensure_recovery_transcript_root(paths)
    destination = safe_child_path(paths.recovery_transcripts, track_id, ".json")
    temporary = destination.with_name(f".{destination.name}.{os.getpid()}.intelligence-recovery-tmp")
    if temporary.exists() or temporary.is_symlink():
        raise RuntimeError(f"Recovery temporary transcript path already exists: {temporary}")
    try:
        with source.open("rb") as input_handle, temporary.open("xb") as output_handle:
            shutil.copyfileobj(input_handle, output_handle, length=1024 * 1024)
        if temporary.stat().st_size != source.stat().st_size:
            raise RuntimeError(f"Staged cached transcript failed size verification for {track_id}.")
        return link_exclusive(temporary, destination)
    finally:
        if temporary.exists() and not temporary.is_symlink():
            temporary.unlink()


def build_daily_runner_command(paths: RuntimePaths, candidates: Sequence[RecoveryCandidate]) -> list[str]:
    if not candidates or len(candidates) > MAX_CANDIDATES:
        raise ValueError("Recovery runner requires a bounded non-empty candidate list.")
    command = [
        str(paths.podcast_python),
        str(paths.daily_runner),
        "--env-file",
        str(paths.env_file),
        "--workspace",
        str(paths.podcast_root),
        "--audio-dir",
        str(paths.audio_dir),
        "--transcribe-dir",
        str(paths.recovery_transcripts),
        "--web-workspace",
        str(paths.web_root),
        "--mc-bin",
        str(paths.mc_bin),
        "--minio-alias",
        MINIO_ALIAS,
        "--minio-bucket",
        MINIO_BUCKET,
        "--minio-prefix",
        MINIO_PREFIX,
        "--max-tracks",
        str(len(candidates)),
        "--skip-rss",
        "--skip-upload",
        "--skip-transcribe",
        "--skip-rag",
        "--transcribe-engine",
        "mistral",
        "--intelligence-workers",
        str(len(candidates)),
        "--intelligence-provider",
        "silo",
        "--intelligence-model",
        INTELLIGENCE_MODEL,
        "--intelligence-reasoning-effort",
        "medium",
        "--no-extractive-fallback",
    ]
    for candidate in candidates:
        command.extend(["--track-id", validate_track_id(candidate.track_id)])
    return command


def fetch_intelligence_verification(conn: Any, track_ids: Sequence[str]) -> dict[str, dict[str, Any]]:
    safe_ids = [validate_track_id(track_id) for track_id in track_ids]
    rows = conn.execute(
        """
        select requested.track_id,
               coalesce(i.status, 'missing') as status,
               count(v.custom_id) filter (where v.embedding is not null) as vector_count
          from unnest(%s::text[]) as requested(track_id)
          left join episode_intelligence i on i.track_id = requested.track_id
          left join episode_intelligence_vectors v on v.track_id = requested.track_id
         group by requested.track_id, i.status
         order by requested.track_id
        """,
        (safe_ids,),
    ).fetchall()
    return {
        text(row["track_id"]): {
            "status": text(row["status"]),
            "vectorCount": int(row["vector_count"] or 0),
        }
        for row in rows
    }


def recover_failed_intelligence(
    conn: Any,
    paths: RuntimePaths,
    child_env: Mapping[str, str],
    *,
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    max_candidates: int = DEFAULT_MAX_CANDIDATES,
    runner: CommandRunner = subprocess.run,
) -> dict[str, Any]:
    candidates = select_recent_failed_intelligence(
        conn,
        lookback_days=lookback_days,
        max_candidates=max_candidates,
    )
    report: dict[str, Any] = {
        "lookbackDays": lookback_days,
        "maxCandidates": max_candidates,
        "runnerAttempts": 0,
        "selected": [
            {"trackId": candidate.track_id, "publishDate": candidate.publish_date, "status": candidate.status}
            for candidate in candidates
        ],
        "verification": {},
    }
    if not candidates:
        return report

    transcripts: dict[str, Path] = {}
    audio_objects: dict[str, MinioAudio] = {}
    for candidate in candidates:
        transcripts[candidate.track_id] = validate_cached_transcript(paths, candidate.track_id)
        audio_objects[candidate.track_id] = stat_minio_audio(
            paths,
            candidate.track_id,
            child_env,
            runner=runner,
        )

    staged: list[OwnedFile] = []
    try:
        for candidate in candidates:
            staged.append(stage_transcript(paths, candidate.track_id, transcripts[candidate.track_id]))
            staged.append(stage_audio(paths, candidate, audio_objects[candidate.track_id], child_env, runner=runner))
        command = build_daily_runner_command(paths, candidates)
        report["runnerAttempts"] = MAX_RUNNER_ATTEMPTS
        result = run_process(
            command,
            cwd=paths.podcast_root,
            env=child_env,
            timeout=RUNNER_TIMEOUT_SECONDS,
            runner=runner,
        )
        if result.returncode != 0:
            detail = safe_output("\n".join(part for part in (result.stdout, result.stderr) if part))
            suffix = f": {detail}" if detail else ""
            raise RuntimeError(f"Bounded intelligence recovery runner failed with status {result.returncode}{suffix}")

        verification = fetch_intelligence_verification(conn, [candidate.track_id for candidate in candidates])
        report["verification"] = verification
        incomplete = {
            candidate.track_id: verification.get(candidate.track_id, {"status": "missing", "vectorCount": 0})
            for candidate in candidates
            if verification.get(candidate.track_id, {}).get("status") != "completed"
            or int(verification.get(candidate.track_id, {}).get("vectorCount") or 0) <= 0
        }
        if incomplete:
            safe_detail = ", ".join(
                f"{track_id}={value['status']}/vectors:{value['vectorCount']}"
                for track_id, value in sorted(incomplete.items())
            )
            raise RuntimeError(f"Intelligence recovery remained incomplete after one bounded attempt: {safe_detail}")
        return report
    finally:
        for item in reversed(staged):
            remove_owned_file(item)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Recover recent failed canonical episode intelligence.")
    parser.add_argument("--env-file", type=Path, default=CANONICAL_AIC_ENV)
    parser.add_argument("--podcast-env-file", type=Path, default=CANONICAL_PODCAST_ENV)
    parser.add_argument("--lookback-days", type=int, default=DEFAULT_LOOKBACK_DAYS)
    parser.add_argument("--max-candidates", type=int, default=DEFAULT_MAX_CANDIDATES)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    paths = RuntimePaths(env_file=args.env_file, podcast_env_file=args.podcast_env_file)
    validate_production_runtime(paths)
    canonical_values = load_canonical_aic_env(args.env_file)
    supplemental_values = load_supplemental_podcast_env(
        args.podcast_env_file,
        canonical_values=canonical_values,
    )
    child_env = canonical_subprocess_env(canonical_values, supplemental_values)
    with psycopg.connect(
        database_dsn(application_name="aic-intelligence-recovery"),
        row_factory=dict_row,
        autocommit=True,
    ) as conn:
        conn.execute("set session characteristics as transaction read only")
        report = recover_failed_intelligence(
            conn,
            paths,
            child_env,
            lookback_days=args.lookback_days,
            max_candidates=args.max_candidates,
        )
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAILED: {safe_output(str(error))}", file=sys.stderr)
        raise SystemExit(1)
