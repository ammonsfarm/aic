import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


PSYCOPG_STUB = types.ModuleType("psycopg")
PSYCOPG_STUB.Connection = object
PSYCOPG_MODULE = sys.modules.setdefault("psycopg", PSYCOPG_STUB)
PSYCOPG_MODULE.rows = types.SimpleNamespace(dict_row=object())

SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "apply_transcript_edit_requests.py"
SPEC = importlib.util.spec_from_file_location("apply_transcript_edit_requests", SCRIPT_PATH)
assert SPEC and SPEC.loader
WORKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKER)


class FakeCursor:
    def __init__(self, chunk_ids):
        self.chunk_ids = chunk_ids
        self.rowcount = 0
        self.executions = []
        self._rows = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params):
        self.executions.append((sql, params))
        if "status = 'applying'" in sql and "for update" in sql:
            self._rows = [(42,)]
        elif "update transcript_segments" in sql:
            self.rowcount = 1
            self._rows = []
        elif "update transcript_chunks" in sql and "returning custom_id" in sql:
            self._rows = [(chunk_id,) for chunk_id in self.chunk_ids]
        else:
            self._rows = []

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None


class FakeConnection:
    def __init__(self, chunk_ids):
        self.fake_cursor = FakeCursor(chunk_ids)

    def cursor(self, **_kwargs):
        return self.fake_cursor


def edit_request():
    return {
        "id": 42,
        "track_id": "track-1",
        "segment_id": "segment-1",
        "source_table": "transcript_segments",
        "source_field": "text",
        "original_text": "Original words",
        "edited_text": "Corrected words",
    }


class TranscriptEditWorkerTests(unittest.TestCase):
    def test_apply_edit_executes_through_status_update_with_chunks(self):
        connection = FakeConnection(["chunk-1"])

        segment_updates, chunks = WORKER.apply_edit(connection, edit_request(), "farm:123", True)

        self.assertEqual(segment_updates, 1)
        self.assertEqual(chunks, ["chunk-1"])
        status_sql, status_params = connection.fake_cursor.executions[-1]
        self.assertIn("status = 'applied'", status_sql)
        self.assertEqual(status_params[0:2], (True, ""))
        self.assertEqual(status_params[2:6], (1, True, True, "farm:123"))
        self.assertEqual(status_params[-1], 42)

    def test_apply_edit_records_truthful_warning_when_no_rag_chunk_matches(self):
        connection = FakeConnection([])

        segment_updates, chunks = WORKER.apply_edit(connection, edit_request(), "farm:123", False)

        self.assertEqual(segment_updates, 1)
        self.assertEqual(chunks, [])
        _status_sql, status_params = connection.fake_cursor.executions[-1]
        self.assertEqual(status_params[0], False)
        self.assertIn("no matching RAG chunk", status_params[1])
        self.assertEqual(status_params[-1], 42)

    def test_claims_one_edit_with_attempt_and_worker_lease(self):
        class Cursor:
            def __init__(self):
                self.executions = []

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def execute(self, sql, params):
                self.executions.append((sql, params))

            def fetchall(self):
                return [{**edit_request(), "attempt_count": 2}]

        class Connection:
            def __init__(self):
                self.fake_cursor = Cursor()

            def cursor(self, **_kwargs):
                return self.fake_cursor

        connection = Connection()
        claimed = WORKER.claim_next_edit(connection, "farm:123", 5, [])

        self.assertEqual(claimed["id"], 42)
        sql, params = connection.fake_cursor.executions[0]
        self.assertIn("limit 1", sql.lower())
        self.assertIn("for update skip locked", sql.lower())
        self.assertIn("attempt_count = r.attempt_count + 1", sql)
        self.assertEqual(params, (5, "farm:123"))

    def test_stale_applying_claims_are_released_for_bounded_retry(self):
        class Cursor:
            rowcount = 3

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def execute(self, sql, params):
                self.sql = sql
                self.params = params

        class Connection:
            def __init__(self):
                self.fake_cursor = Cursor()

            def cursor(self, **_kwargs):
                return self.fake_cursor

        connection = Connection()
        recovered = WORKER.recover_stale_edits(connection, 900, 5)

        self.assertEqual(recovered, 3)
        self.assertIn("status = 'applying'", connection.fake_cursor.sql)
        self.assertIn("'infinity'::timestamptz", connection.fake_cursor.sql)
        self.assertEqual(connection.fake_cursor.params, (5, 5, 900))

    def test_failures_back_off_and_become_terminal(self):
        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def execute(self, sql, params):
                self.sql = sql
                self.params = params

        class Connection:
            def __init__(self):
                self.fake_cursor = Cursor()

            def cursor(self, **_kwargs):
                return self.fake_cursor

        connection = Connection()
        WORKER.mark_failed(connection, 42, 5, 5, 120, "farm:123", RuntimeError("conflict"))

        self.assertIn("'infinity'::timestamptz", connection.fake_cursor.sql)
        self.assertIn("Terminal failure after 5 attempts", connection.fake_cursor.params[0])
        self.assertTrue(connection.fake_cursor.params[1])
        self.assertEqual(WORKER.retry_delay_seconds(1, 120), 120)
        self.assertEqual(WORKER.retry_delay_seconds(10, 120), 3_600)

    def test_missing_embedding_key_is_a_failure_not_false_success(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "OPENAI_API_KEY"):
                WORKER.revectorize_chunks(object(), 42, ["chunk-1"], "configured-model", "farm:123")

    def test_embedding_model_is_resolved_after_environment_loading(self):
        with patch.dict(os.environ, {"OPENAI_EMBEDDING_MODEL": "env-model"}, clear=True):
            self.assertEqual(WORKER.resolve_embedding_model(None), "env-model")
            self.assertEqual(WORKER.resolve_embedding_model("cli-model"), "cli-model")

    def test_applied_needs_revectorization_rows_have_a_real_claim_path(self):
        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def execute(self, sql, params):
                self.sql = sql
                self.params = params

            def fetchall(self):
                return [{"id": 42, "revectorization_attempt_count": 1}]

        class Connection:
            def __init__(self):
                self.fake_cursor = Cursor()

            def cursor(self, **_kwargs):
                return self.fake_cursor

        connection = Connection()
        pending = WORKER.claim_pending_revectorization(connection, "farm:123", 5)

        self.assertEqual(pending["id"], 42)
        self.assertIn("status = 'applied'", connection.fake_cursor.sql)
        self.assertIn("needs_revectorization", connection.fake_cursor.sql)
        self.assertIn("for update skip locked", connection.fake_cursor.sql.lower())
        self.assertIn("revectorization_attempt_count = r.revectorization_attempt_count + 1", connection.fake_cursor.sql)
        self.assertIn("revectorization_claimed_at = now()", connection.fake_cursor.sql)
        self.assertEqual(connection.fake_cursor.params, (5, "farm:123"))

    def test_stale_revectorization_claims_are_recovered(self):
        class Cursor:
            rowcount = 2

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def execute(self, sql, params):
                self.sql = sql
                self.params = params

        class Connection:
            def __init__(self):
                self.fake_cursor = Cursor()

            def cursor(self, **_kwargs):
                return self.fake_cursor

        connection = Connection()
        recovered = WORKER.recover_stale_revectorizations(connection, 900, 5)

        self.assertEqual(recovered, 2)
        self.assertIn("revectorization_claimed_at is not null", connection.fake_cursor.sql)
        self.assertIn("revectorization_worker_id = ''", connection.fake_cursor.sql)
        self.assertEqual(connection.fake_cursor.params, (5, 5, 900))

    def test_terminal_reset_requires_an_audited_database_write(self):
        class Cursor:
            rowcount = 1

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def execute(self, sql, params):
                self.sql = sql
                self.params = params

        class Connection:
            def __init__(self):
                self.fake_cursor = Cursor()

            def cursor(self, **_kwargs):
                return self.fake_cursor

        connection = Connection()
        reset = WORKER.reset_terminal_requests(
            connection,
            [42],
            "admin@example.test",
            "Reviewed and retrying after configuration repair.",
        )

        self.assertEqual(reset, 1)
        self.assertIn("transcript_terminal_retry_reset", connection.fake_cursor.sql)
        self.assertIn("admin_operation_audit", connection.fake_cursor.sql)
        self.assertEqual(connection.fake_cursor.params[0], [42])
        self.assertEqual(connection.fake_cursor.params[1], "admin@example.test")

    def test_revectorization_failure_releases_claim_without_lost_increment(self):
        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def execute(self, sql, params):
                self.sql = sql
                self.params = params

        class Connection:
            def __init__(self):
                self.fake_cursor = Cursor()

            def cursor(self, **_kwargs):
                return self.fake_cursor

        connection = Connection()
        WORKER.mark_revectorization_failed(connection, 42, 5, 5, 120, "farm:123", RuntimeError("no key"))

        self.assertNotIn("revectorization_attempt_count =", connection.fake_cursor.sql)
        self.assertIn("revectorization_claimed_at = null", connection.fake_cursor.sql)
        self.assertIn("Terminal re-vectorization failure after 5 attempts", connection.fake_cursor.params[0])
        self.assertTrue(connection.fake_cursor.params[1])
        self.assertEqual(connection.fake_cursor.params[-1], "farm:123")


if __name__ == "__main__":
    unittest.main()
