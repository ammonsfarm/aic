import importlib.util
import sys
import types
import unittest
from pathlib import Path


PSYCOPG_STUB = types.ModuleType("psycopg")
PSYCOPG_STUB.Connection = object
PSYCOPG_STUB.rows = types.SimpleNamespace(dict_row=object())
sys.modules.setdefault("psycopg", PSYCOPG_STUB)

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
        if "update transcript_segments" in sql:
            self.rowcount = 1
            self._rows = []
        elif "update transcript_chunks" in sql and "returning custom_id" in sql:
            self._rows = [(chunk_id,) for chunk_id in self.chunk_ids]
        else:
            self._rows = []

    def fetchall(self):
        return self._rows


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

        segment_updates, chunks = WORKER.apply_edit(connection, edit_request())

        self.assertEqual(segment_updates, 1)
        self.assertEqual(chunks, ["chunk-1"])
        status_sql, status_params = connection.fake_cursor.executions[-1]
        self.assertIn("status = 'applied'", status_sql)
        self.assertEqual(status_params, (True, "", 42))

    def test_apply_edit_records_truthful_warning_when_no_rag_chunk_matches(self):
        connection = FakeConnection([])

        segment_updates, chunks = WORKER.apply_edit(connection, edit_request())

        self.assertEqual(segment_updates, 1)
        self.assertEqual(chunks, [])
        _status_sql, status_params = connection.fake_cursor.executions[-1]
        self.assertEqual(status_params[0], False)
        self.assertIn("no matching RAG chunk", status_params[1])
        self.assertEqual(status_params[2], 42)


if __name__ == "__main__":
    unittest.main()
