from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest


PSYCOPG_STUB = types.ModuleType("psycopg")
PSYCOPG_STUB.Connection = object
PSYCOPG_ROWS_STUB = types.ModuleType("psycopg.rows")
PSYCOPG_ROWS_STUB.dict_row = object()
sys.modules.setdefault("psycopg", PSYCOPG_STUB)
sys.modules.setdefault("psycopg.rows", PSYCOPG_ROWS_STUB)

SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "recover_failed_episode_intelligence.py"
SPEC = importlib.util.spec_from_file_location("recover_failed_episode_intelligence", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return list(self.rows)


class Connection:
    def __init__(self, candidates):
        self.candidates = list(candidates)
        self.completed = False
        self.calls = []

    def execute(self, sql, params):
        self.calls.append((sql, params))
        if "from episode_intelligence i" in sql:
            return Result(self.candidates)
        if "from unnest" in sql:
            return Result(
                [
                    {
                        "track_id": track_id,
                        "status": "completed" if self.completed else "failed",
                        "vector_count": 3 if self.completed else 0,
                    }
                    for track_id in params[0]
                ]
            )
        raise AssertionError(sql)


class Runner:
    def __init__(self, connection, *, minio_size=11, complete=True, minio_name="2362307285.mp3"):
        self.connection = connection
        self.minio_size = minio_size
        self.complete = complete
        self.minio_name = minio_name
        self.calls = []

    def __call__(self, command, **kwargs):
        self.calls.append((list(command), dict(kwargs)))
        if len(command) > 1 and command[1] == "stat":
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=json.dumps({"name": self.minio_name, "size": self.minio_size}) + "\n",
                stderr="",
            )
        if len(command) > 1 and command[1] == "cp":
            Path(command[-1]).write_bytes(b"audio-bytes")
            return subprocess.CompletedProcess(command, 0, stdout="", stderr="")
        if len(command) > 1 and command[1].endswith("run_daily_podcast_ingest.py"):
            self.connection.completed = self.complete
            return subprocess.CompletedProcess(command, 0, stdout="runner complete", stderr="")
        raise AssertionError(command)


def candidate(track_id="2362307285", status="rate_limited"):
    return {"track_id": track_id, "publish_date": "2026-07-29", "status": status}


class FailedEpisodeIntelligenceRecoveryTests(unittest.TestCase):
    def runtime(self, root: Path):
        podcast_root = root / "aic_podcast"
        web_root = root / "aic"
        audio_dir = root / "podcasts"
        cache = podcast_root / "transcript_cache"
        recovery = podcast_root / "intelligence_recovery_transcripts"
        for directory in (podcast_root, web_root, audio_dir, cache):
            directory.mkdir(parents=True, exist_ok=True)
        python = podcast_root / "python"
        runner = podcast_root / "run_daily_podcast_ingest.py"
        mc = root / "mc"
        for file in (python, runner, mc):
            file.write_text("test", encoding="utf-8")
            file.chmod(0o700)
        return MODULE.RuntimePaths(
            env_file=root / ".env",
            podcast_env_file=podcast_root / ".env",
            web_root=web_root,
            podcast_root=podcast_root,
            audio_dir=audio_dir,
            transcript_cache=cache,
            recovery_transcripts=recovery,
            podcast_python=python,
            daily_runner=runner,
            mc_bin=mc,
        )

    def test_recovery_stages_exact_minio_audio_reuses_cache_and_cleans_owned_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            paths = self.runtime(Path(temporary))
            cached = paths.transcript_cache / "2362307285.json"
            cached.write_text(json.dumps({"segments": [{"text": "sermon"}]}), encoding="utf-8")
            connection = Connection([candidate()])
            runner = Runner(connection)

            report = MODULE.recover_failed_intelligence(
                connection,
                paths,
                {"PATH": "/fixed"},
                runner=runner,
            )

            self.assertEqual(report["runnerAttempts"], 1)
            self.assertEqual(report["verification"]["2362307285"], {"status": "completed", "vectorCount": 3})
            self.assertTrue(cached.is_file())
            self.assertFalse((paths.audio_dir / "2362307285.mp3").exists())
            self.assertFalse((paths.recovery_transcripts / "2362307285.json").exists())

            commands = [command for command, _kwargs in runner.calls]
            self.assertEqual(
                commands[0],
                [str(paths.mc_bin), "stat", "--json", "local-minio/aic/podcasts/2362307285.mp3"],
            )
            self.assertEqual(commands[1][1:4], ["cp", "--preserve", "local-minio/aic/podcasts/2362307285.mp3"])
            daily = commands[2]
            for flag in ("--skip-rss", "--skip-upload", "--skip-transcribe", "--skip-rag"):
                self.assertIn(flag, daily)
            self.assertNotIn("--skip-audio-cleanup", daily)
            self.assertEqual(daily[-2:], ["--track-id", "2362307285"])
            self.assertEqual(daily[daily.index("--audio-dir") + 1], str(paths.audio_dir))
            self.assertEqual(daily[daily.index("--transcribe-dir") + 1], str(paths.recovery_transcripts))
            for _command, kwargs in runner.calls:
                self.assertFalse(kwargs["shell"])
                self.assertEqual(kwargs["env"], {"PATH": "/fixed"})

    def test_incomplete_status_or_vectors_returns_error_and_still_cleans_staging(self):
        with tempfile.TemporaryDirectory() as temporary:
            paths = self.runtime(Path(temporary))
            (paths.transcript_cache / "2362307285.json").write_text("{}", encoding="utf-8")
            connection = Connection([candidate(status="failed")])
            runner = Runner(connection, complete=False)

            with self.assertRaisesRegex(RuntimeError, "remained incomplete"):
                MODULE.recover_failed_intelligence(connection, paths, {}, runner=runner)

            self.assertFalse((paths.audio_dir / "2362307285.mp3").exists())
            self.assertFalse((paths.recovery_transcripts / "2362307285.json").exists())

    def test_missing_cache_or_wrong_minio_identity_fails_before_daily_runner(self):
        with tempfile.TemporaryDirectory() as temporary:
            paths = self.runtime(Path(temporary))
            connection = Connection([candidate()])
            runner = Runner(connection)
            with self.assertRaisesRegex(RuntimeError, "no canonical cached transcript"):
                MODULE.recover_failed_intelligence(connection, paths, {}, runner=runner)
            self.assertEqual(runner.calls, [])

            (paths.transcript_cache / "2362307285.json").write_text("{}", encoding="utf-8")
            wrong_minio = Runner(connection, minio_name="another.mp3")
            with self.assertRaisesRegex(RuntimeError, "MinIO audio stat was invalid"):
                MODULE.recover_failed_intelligence(connection, paths, {}, runner=wrong_minio)
            self.assertEqual(len(wrong_minio.calls), 1)

    def test_oversized_minio_audio_fails_before_staging(self):
        with tempfile.TemporaryDirectory() as temporary:
            paths = self.runtime(Path(temporary))
            (paths.transcript_cache / "2362307285.json").write_text("{}", encoding="utf-8")
            connection = Connection([candidate()])
            oversized_minio = Runner(connection, minio_size=MODULE.MAX_AUDIO_BYTES + 1)

            with self.assertRaisesRegex(RuntimeError, "MinIO audio stat was invalid"):
                MODULE.recover_failed_intelligence(connection, paths, {}, runner=oversized_minio)

            self.assertEqual(len(oversized_minio.calls), 1)
            self.assertEqual(oversized_minio.calls[0][0][1], "stat")
            self.assertFalse((paths.audio_dir / "2362307285.mp3").exists())

    def test_recent_failed_selection_is_bounded_and_rejects_unsafe_ids(self):
        overflow = Connection([candidate(str(index + 1)) for index in range(MODULE.MAX_CANDIDATES + 1)])
        with self.assertRaisesRegex(RuntimeError, "candidate safety bound"):
            MODULE.select_recent_failed_intelligence(overflow, lookback_days=14, max_candidates=4)
        self.assertIn("i.status in ('failed', 'rate_limited')", overflow.calls[0][0])
        with self.assertRaises(RuntimeError):
            MODULE.select_recent_failed_intelligence(
                Connection([candidate("../../owned")]),
                lookback_days=14,
                max_candidates=4,
            )

    def test_production_authority_and_fixed_paths_are_not_runtime_overridable(self):
        paths = MODULE.RuntimePaths()
        self.assertEqual(paths.env_file, Path("/mnt/storage/aic/.env"))
        self.assertEqual(paths.podcast_env_file, Path("/mnt/storage/aic_podcast/.env"))
        self.assertEqual(paths.audio_dir, Path("/mnt/storage/podcasts"))
        self.assertEqual(paths.transcript_cache, Path("/mnt/storage/aic_podcast/transcript_cache"))
        self.assertEqual(MODULE.minio_audio_source("2362307285"), "local-minio/aic/podcasts/2362307285.mp3")
        self.assertEqual(MODULE.MAX_AUDIO_BYTES, 250 * 1024 * 1024)
        with self.assertRaises(RuntimeError):
            MODULE.validate_track_id("unsafe/track")


if __name__ == "__main__":
    unittest.main()
