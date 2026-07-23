import contextlib
import datetime as dt
import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock


PSYCOPG_STUB = types.ModuleType("psycopg")
PSYCOPG_ROWS_STUB = types.ModuleType("psycopg.rows")
PSYCOPG_ROWS_STUB.dict_row = object()
PSYCOPG_MODULE = sys.modules.setdefault("psycopg", PSYCOPG_STUB)
PSYCOPG_ROWS_MODULE = sys.modules.setdefault("psycopg.rows", PSYCOPG_ROWS_STUB)
if not hasattr(PSYCOPG_MODULE, "connect"):
    PSYCOPG_MODULE.connect = lambda *_args, **_kwargs: None
if not hasattr(PSYCOPG_ROWS_MODULE, "dict_row"):
    PSYCOPG_ROWS_MODULE.dict_row = object()


SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "process_episode_publish_requests.py"
SPEC = importlib.util.spec_from_file_location("process_episode_publish_requests", SCRIPT_PATH)
WORKER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = WORKER
SPEC.loader.exec_module(WORKER)

TRANSCRIPT_SYNC_PATH = Path(__file__).resolve().parents[2] / "sync_transcript_segments_to_postgres.py"
SYNC_SPEC = importlib.util.spec_from_file_location("sync_transcript_segments_to_postgres", TRANSCRIPT_SYNC_PATH)
SYNC = importlib.util.module_from_spec(SYNC_SPEC)
assert SYNC_SPEC and SYNC_SPEC.loader
SYNC_SPEC.loader.exec_module(SYNC)


class FakeStrapi:
    def __init__(self, rows):
        self.rows = rows
        self.updates = []

    def list_requests(self, status, **_kwargs):
        return [row.copy() for row in self.rows if row.get("status") == status]

    def update_request(self, document_id, data):
        self.updates.append((document_id, data.copy()))
        row = next(row for row in self.rows if row["documentId"] == document_id)
        row.update(data)
        return row.copy()

    def get_request(self, document_id):
        return next(row.copy() for row in self.rows if row["documentId"] == document_id)

    def latest_request(self, episode_document_id):
        matches = [row for row in self.rows if row.get("episodeDocumentId") == episode_document_id]
        if not matches:
            return None
        return max(matches, key=lambda row: int(row.get("revisionNumber") or 0)).copy()


class FakeConnection:
    def __init__(self, *, existing_episode=False, owners=None):
        self.sql = ""
        self.params = None
        self.queries = []
        self.existing_episode = existing_episode
        self.owners = list(owners or [])

    def transaction(self):
        return contextlib.nullcontext()

    def execute(self, sql, params=()):
        self.sql = " ".join(sql.split()).lower()
        self.params = params
        self.queries.append((self.sql, params))
        return self

    def fetchone(self):
        if "select track_id from episodes" in self.sql:
            return {"track_id": self.params[0]} if self.existing_episode else None
        if "from episode_processing_ownership" in self.sql:
            track_id, document_id = self.params
            return next((row for row in self.owners if row["track_id"] == track_id and row["episode_document_id"] == document_id), None)
        if "returning track_id" in self.sql:
            return {"track_id": self.params[0]}
        return None

    def fetchall(self):
        if "from episode_processing_ownership" not in self.sql:
            return []
        track_id, document_id = self.params
        return [
            row for row in self.owners
            if row["track_id"] == track_id or row["episode_document_id"] == document_id
        ]


class EpisodePublishWorkerTests(unittest.TestCase):
    def test_supported_track_ids_include_sermonaudio_and_safe_cms_ids(self):
        for value in ["1003386838", "sa_99151132260", "wp-sermon:14759", "cms_sunday_20260722"]:
            self.assertEqual(WORKER.validate_track_id(value), value)
        for value in ["", "../secret", "sa_bad", "cms_../secret", "track with spaces", "9" * 101]:
            with self.assertRaises(ValueError):
                WORKER.validate_track_id(value)

    def test_stale_claim_is_requeued_but_attempt_bound_is_terminal(self):
        now = dt.datetime(2026, 7, 22, 16, 0, tzinfo=dt.UTC)
        client = FakeStrapi([
            {"documentId": "retryable", "status": "running", "attemptCount": 2},
            {"documentId": "terminal", "status": "running", "attemptCount": 6},
        ])
        recovered = WORKER.recover_stale_requests(
            client,
            now=now,
            stale_seconds=3600,
            max_attempts=6,
        )
        self.assertEqual(recovered, ["retryable", "terminal"])
        updates = {document_id: data for document_id, data in client.updates}
        self.assertEqual(updates["retryable"]["status"], "queued")
        self.assertIsNone(updates["retryable"]["completedAt"])
        self.assertEqual(updates["terminal"]["status"], "failed")
        self.assertEqual(updates["terminal"]["completedAt"], WORKER.iso(now))

    def test_claim_increments_attempt_and_is_idempotently_serialized_by_status(self):
        now = dt.datetime(2026, 7, 22, 16, 0, tzinfo=dt.UTC)
        client = FakeStrapi([{"documentId": "request-1", "status": "queued", "attemptCount": 1}])
        claimed = WORKER.claim_request(client, now=now, worker_id="farm:1", max_attempts=6)
        self.assertEqual(claimed["status"], "running")
        self.assertEqual(claimed["attemptCount"], 2)
        self.assertEqual(claimed["workerId"], "farm:1")
        self.assertIsNone(WORKER.claim_request(client, now=now, worker_id="farm:2", max_attempts=6))

    def test_terminal_request_does_not_block_the_next_due_claim(self):
        now = dt.datetime(2026, 7, 22, 16, 0, tzinfo=dt.UTC)
        client = FakeStrapi([
            {"documentId": "terminal", "status": "queued", "attemptCount": 6},
            {"documentId": "eligible", "status": "queued", "attemptCount": 0},
        ])
        claimed = WORKER.claim_request(client, now=now, worker_id="farm:1", max_attempts=6)
        self.assertEqual(claimed["documentId"], "eligible")
        self.assertEqual(client.rows[0]["status"], "failed")

    def test_newer_publication_stops_and_never_requeues_the_running_old_revision(self):
        now = dt.datetime(2026, 7, 22, 16, 0, tzinfo=dt.UTC)
        old = {
            "documentId": "request-old",
            "episodeDocumentId": "episode-doc",
            "requestKey": "episode-doc:revision:1",
            "revisionNumber": 1,
            "status": "running",
            "attemptCount": 1,
            "workerId": "farm:1",
        }
        client = FakeStrapi([
            old.copy(),
            {
                "documentId": "request-new",
                "episodeDocumentId": "episode-doc",
                "requestKey": "episode-doc:revision:2",
                "revisionNumber": 2,
                "status": "queued",
                "attemptCount": 0,
                "workerId": "",
            },
        ])

        self.assertFalse(WORKER.mark_failed(client, old, RuntimeError("old failed"), now=now, max_attempts=6))
        self.assertEqual(client.rows[0]["status"], "superseded")
        self.assertEqual(client.rows[1]["status"], "queued")
        self.assertNotIn("nextAttemptAt", client.rows[0])

    def test_old_revision_cannot_complete_after_a_newer_publication(self):
        now = dt.datetime(2026, 7, 22, 16, 0, tzinfo=dt.UTC)
        old = {
            "documentId": "request-old",
            "episodeDocumentId": "episode-doc",
            "requestKey": "episode-doc:revision:1",
            "revisionNumber": 1,
            "status": "running",
            "attemptCount": 1,
            "workerId": "farm:1",
        }
        client = FakeStrapi([
            old.copy(),
            {
                "documentId": "request-new",
                "episodeDocumentId": "episode-doc",
                "requestKey": "episode-doc:revision:2",
                "revisionNumber": 2,
                "status": "queued",
                "attemptCount": 0,
                "workerId": "",
            },
        ])

        with self.assertRaises(WORKER.RequestNoLongerCurrent):
            WORKER.mark_completed(client, old, {"stale": True}, now=now)
        self.assertEqual(client.rows[0]["status"], "superseded")
        self.assertNotEqual(client.rows[0].get("result"), {"stale": True})

    def test_duplicate_publication_with_matching_complete_provenance_is_a_noop(self):
        decision = WORKER.processing_decision(
            {"forceReprocess": False, "revisionNumber": 9},
            {"complete": True},
            {"revision_number": 8, "audio_fingerprint": "sha256:same"},
            "sha256:same",
            "minio:local-minio/aic/podcasts/sa_42.mp3",
        )
        self.assertEqual(decision, ("matching_complete_provenance", False))

    def test_changed_audio_and_explicit_retry_require_retranscription(self):
        changed = WORKER.processing_decision(
            {"forceReprocess": False},
            {"complete": False},
            {"audio_fingerprint": "sha256:old"},
            "sha256:new",
            "strapi:/uploads/new.mp3",
        )
        forced = WORKER.processing_decision(
            {"forceReprocess": True},
            {"complete": True},
            {"audio_fingerprint": "sha256:same"},
            "sha256:same",
            "minio:local-minio/aic/podcasts/42.mp3",
        )
        self.assertEqual(changed, ("audio_changed", True))
        self.assertEqual(forced, ("explicit_reprocess", True))

    def test_first_complete_minio_request_adopts_baseline_but_new_upload_does_not(self):
        adopted = WORKER.processing_decision(
            {},
            {"complete": True},
            None,
            "sha256:existing",
            "minio:local-minio/aic/podcasts/42.mp3",
        )
        uploaded = WORKER.processing_decision(
            {},
            {"complete": True},
            None,
            "sha256:new",
            "strapi:/uploads/new.mp3",
        )
        self.assertEqual(adopted, ("adopt_existing_coverage", False))
        self.assertEqual(uploaded, ("untracked_managed_audio", True))

    def test_operational_connection_uses_autocommit_across_external_pipeline(self):
        connection = object()
        with (
            mock.patch.object(WORKER, "dsn", return_value="test-dsn"),
            mock.patch.object(WORKER.psycopg, "connect", return_value=connection) as connect,
        ):
            self.assertIs(WORKER.connect_operational_database(), connection)
        connect.assert_called_once_with("test-dsn", autocommit=True, row_factory=WORKER.dict_row)

    def test_audio_fingerprint_is_stable_sha256_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "episode.mp3"
            path.write_bytes(b"abc")
            staged = WORKER.staged_audio(path, "strapi:/uploads/episode.mp3")
        self.assertEqual(
            staged.fingerprint,
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        )

    def test_operational_upsert_never_replaces_richer_values_with_blanks(self):
        connection = FakeConnection()
        track_id = WORKER.upsert_operational_episode(
            connection,
            {"documentId": "request-1", "episodeDocumentId": "episode-doc-1"},
            {
                "trackId": "sa_42",
                "title": "Published title",
                "programDate": "",
                "publishDate": "",
                "summary": "",
                "description": "",
            },
        )
        self.assertEqual(track_id, "sa_42")
        self.assertIn("coalesce(nullif(excluded.publish_date, ''), episodes.publish_date)", connection.sql)
        self.assertIn("coalesce(nullif(excluded.detail, ''), episodes.detail)", connection.sql)
        self.assertIn("coalesce(nullif(episodes.source_file, ''), excluded.source_file)", connection.sql)
        ownership_insert = next(sql for sql, _params in connection.queries if "insert into episode_processing_ownership" in sql)
        episode_upsert = next(sql for sql, _params in connection.queries if "insert into episodes" in sql)
        self.assertLess(connection.queries.index(next(item for item in connection.queries if item[0] == ownership_insert)), connection.queries.index(next(item for item in connection.queries if item[0] == episode_upsert)))

    def test_existing_track_cannot_be_claimed_by_a_different_strapi_episode(self):
        connection = FakeConnection(
            existing_episode=True,
            owners=[{
                "track_id": "sa_42",
                "episode_document_id": "original-doc",
                "source_fingerprint": "",
            }],
        )
        with self.assertRaisesRegex(ValueError, "permanently owned"):
            WORKER.upsert_operational_episode(
                connection,
                {"documentId": "request-2", "episodeDocumentId": "replacement-doc"},
                {"trackId": "sa_42", "title": "Replacement"},
            )
        self.assertFalse(any("insert into episodes" in sql for sql, _params in connection.queries))

    def test_unowned_existing_track_requires_a_trusted_cutover_fingerprint(self):
        request = {"documentId": "request-1", "episodeDocumentId": "imported-doc"}
        with self.assertRaisesRegex(ValueError, "explicit baseline reconciliation"):
            WORKER.upsert_operational_episode(
                FakeConnection(existing_episode=True),
                request,
                {"trackId": "wp-sermon:14759", "title": "Imported"},
            )
        connection = FakeConnection(existing_episode=True)
        self.assertEqual(
            WORKER.upsert_operational_episode(
                connection,
                request,
                {
                    "trackId": "wp-sermon:14759",
                    "title": "Imported",
                    "sourceFingerprint": "a" * 64,
                },
            ),
            "wp-sermon:14759",
        )

    def test_remote_or_missing_audio_fails_with_actionable_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, "remote URLs are not fetched"):
                WORKER.stage_audio(
                    {"trackId": "cms_new", "externalAudioUrl": "https://example.com/audio.mp3"},
                    "cms_new",
                    audio_dir=root / "stage",
                    strapi_media_root=root / "strapi",
                    public_media_root=root / "public",
                    mc_bin=Path("/bin/false"),
                )
            with self.assertRaisesRegex(FileNotFoundError, "Upload audio before retrying"):
                WORKER.stage_audio(
                    {"trackId": "cms_new"},
                    "cms_new",
                    audio_dir=root / "stage",
                    strapi_media_root=root / "strapi",
                    public_media_root=root / "public",
                    mc_bin=Path("/bin/false"),
                )

    def test_invalid_managed_audio_and_cross_track_paths_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            uploads = root / "strapi"
            uploads.mkdir()
            (uploads / "not-an-mp3.wav").write_bytes(b"RIFF")
            with self.assertRaisesRegex(ValueError, "requires MP3"):
                WORKER.stage_audio(
                    {"trackId": "sa_42", "audio": {"url": "/uploads/not-an-mp3.wav"}},
                    "sa_42",
                    audio_dir=root / "stage",
                    strapi_media_root=uploads,
                    public_media_root=root / "public",
                    mc_bin=Path("/bin/false"),
                )
            with self.assertRaisesRegex(ValueError, "does not match"):
                WORKER.stage_audio(
                    {"trackId": "sa_42", "externalAudioUrl": "/media/episodes/sa_99"},
                    "sa_42",
                    audio_dir=root / "stage",
                    strapi_media_root=uploads,
                    public_media_root=root / "public",
                    mc_bin=Path("/bin/false"),
                )

    def test_pipeline_retranscription_flag_is_explicit(self):
        completed = mock.Mock(returncode=0, stdout="", stderr="")
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            WORKER.subprocess,
            "run",
            return_value=completed,
        ) as run:
            result = WORKER.run_pipeline(
                {"documentId": "request-1", "revisionNumber": 2, "attemptCount": 1},
                "sa_42",
                podcast_root=Path(directory),
                podcast_env_file=Path(directory) / ".env",
                timeout_seconds=30,
                retranscribe=True,
            )
        command = run.call_args.args[0]
        self.assertIn("--retranscribe", command)
        limit_index = command.index("--mistral-max-file-mb")
        self.assertEqual(command[limit_index + 1], "250")
        self.assertTrue(result["retranscribed"])

    def test_worker_errors_are_bounded_and_secret_values_are_redacted(self):
        message = WORKER.sanitized_error(
            RuntimeError("Authorization: Bearer top-secret password=hunter2 API_KEY:abcdef")
        )
        self.assertNotIn("top-secret", message)
        self.assertNotIn("hunter2", message)
        self.assertNotIn("abcdef", message)
        self.assertIn("[redacted]", message)

    def test_transcript_sync_accepts_sa_and_cms_ids_but_rejects_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "transcripts"
            root.mkdir()
            for name in ["100.json", "sa_200.json", "cms_sunday.json", "wp-sermon:300.json", "bad.name.json"]:
                (root / name).write_text("{}")
            outside = base / "999.json"
            outside.write_text("{}")
            selected = SYNC.transcript_paths(
                root,
                ["100", "sa_200", "cms_sunday", "wp-sermon:300", "bad.name", "../999"],
                0,
            )
            self.assertEqual([path.stem for path in selected], ["100", "sa_200", "cms_sunday", "wp-sermon:300"])


if __name__ == "__main__":
    unittest.main()
