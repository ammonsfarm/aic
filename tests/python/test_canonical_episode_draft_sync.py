from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import types
import unittest


PSYCOPG_STUB = types.ModuleType("psycopg")
PSYCOPG_STUB.Connection = object
PSYCOPG_ROWS_STUB = types.ModuleType("psycopg.rows")
PSYCOPG_ROWS_STUB.dict_row = object()
sys.modules.setdefault("psycopg", PSYCOPG_STUB)
sys.modules.setdefault("psycopg.rows", PSYCOPG_ROWS_STUB)

SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "sync_canonical_episode_drafts.py"
SPEC = importlib.util.spec_from_file_location("sync_canonical_episode_drafts", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def row(track_id: str, title: str = "A New Episode", publish_date: str = "2026-07-29"):
    return {
        "track_id": track_id,
        "title": title,
        "publish_date": publish_date,
        "detail": "<p>A faithful summary with <strong>markup</strong>.</p>",
        "source_file": f"{track_id}.mp3",
        "updated_at": "2026-07-29T12:00:00+00:00",
    }


class Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return list(self.rows)


class Connection:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def execute(self, sql, params):
        self.calls.append((sql, params))
        return Result(self.rows)


class FakeClient:
    def __init__(self, records=()):
        self.records = [dict(record) for record in records]
        self.create_calls = []

    def find_any(self, field, value):
        matches = [record for record in self.records if record.get(field) == value]
        if len({record.get("documentId") for record in matches}) > 1:
            raise RuntimeError("duplicate")
        return matches[:1]

    def find_by_status(self, field, value, status):
        matches = [record for record in self.records if record.get(field) == value]
        if status == "published":
            return [record for record in matches if record.get("publishedAt")]
        return [record for record in matches if not record.get("publishedAt")]

    def create_episode(self, data):
        self.create_calls.append(dict(data))
        record = {
            **data,
            "documentId": f"doc-{data['trackId']}",
            "publishedAt": None,
            "scheduledFor": None,
        }
        self.records.append(record)
        return record


class CanonicalEpisodeDraftSyncTests(unittest.TestCase):
    def test_apply_is_create_only_and_idempotent_without_overwriting_existing_editorial_data(self):
        existing = {
            "trackId": "2367234089",
            "documentId": "existing-doc",
            "slug": "editor-chosen-slug",
            "title": "Editor changed this title",
            "publishedAt": None,
        }
        client = FakeClient([existing])
        connection = Connection([row("2367234089"), row("2367244871")])

        first = MODULE.synchronize_episode_drafts(
            connection,
            client,
            apply=True,
            confirmation=MODULE.APPLY_CONFIRMATION,
        )

        self.assertEqual([item["trackId"] for item in first["created"]], ["2367244871"])
        self.assertEqual(len(client.create_calls), 1)
        self.assertEqual(client.records[0], existing)
        self.assertEqual(first["existingPreserved"][0]["documentId"], "existing-doc")

        second = MODULE.synchronize_episode_drafts(
            connection,
            client,
            apply=True,
            confirmation=MODULE.APPLY_CONFIRMATION,
        )
        self.assertEqual(second["created"], [])
        self.assertEqual(len(client.create_calls), 1)
        self.assertEqual(client.records[0], existing)

    def test_dry_run_uses_stable_collision_safe_slugs_without_mutation(self):
        client = FakeClient()
        episodes = [
            MODULE.canonical_episode_from_row(row("2367234089", "Same Title")),
            MODULE.canonical_episode_from_row(row("2367244871", "Same Title")),
        ]
        planned, _existing = MODULE.plan_episode_drafts(episodes, client, max_creates=2)
        again, _existing_again = MODULE.plan_episode_drafts(episodes, FakeClient(), max_creates=2)

        self.assertEqual([item.slug for item in planned], [item.slug for item in again])
        self.assertEqual(len({item.slug for item in planned}), 2)
        self.assertEqual(planned[0].slug, "same-title")
        self.assertRegex(planned[1].slug, r"^same-title-[a-f0-9]{8}$")
        self.assertEqual(client.create_calls, [])

    def test_payload_has_canonical_audio_dates_summary_seo_and_provenance(self):
        episode = MODULE.canonical_episode_from_row(row("2362307285", publish_date="2026-07-29"))
        payload = MODULE.build_episode_payload(episode, "a-new-episode")

        self.assertEqual(payload["programDate"], "2026-07-29")
        self.assertEqual(payload["publishDate"], "2026-07-29T00:00:00Z")
        self.assertEqual(payload["summary"], "A faithful summary with markup .")
        self.assertEqual(payload["description"], row("2362307285")["detail"])
        self.assertEqual(payload["externalAudioUrl"], "/media/episodes/2362307285")
        self.assertEqual(payload["legacyId"], "aic:2362307285")
        self.assertEqual(payload["scheduledFor"], None)
        self.assertEqual(payload["seo"]["canonicalUrl"], "https://www.pastorwood.org/radio/a-new-episode/")
        self.assertRegex(payload["sourceFingerprint"], r"^[a-f0-9]{64}$")

    def test_unsafe_identity_and_all_bounds_fail_before_create(self):
        with self.assertRaises(RuntimeError):
            MODULE.validate_track_id("../../owned")
        with self.assertRaises(RuntimeError):
            MODULE.canonical_episode_from_row(row("2362307285", title="x" * 256))
        with self.assertRaises(RuntimeError):
            MODULE.select_recent_canonical_episodes(
                Connection([row(str(index + 1)) for index in range(MODULE.MAX_SCAN_ROWS + 1)]),
                lookback_days=14,
            )
        client = FakeClient()
        episodes = [MODULE.canonical_episode_from_row(row(str(index + 1))) for index in range(3)]
        with self.assertRaises(RuntimeError):
            MODULE.plan_episode_drafts(episodes, client, max_creates=2)
        self.assertEqual(client.create_calls, [])
        legacy_collision = FakeClient(
            [{"trackId": "different-track", "legacyId": "aic:2362307285", "documentId": "other-doc"}]
        )
        with self.assertRaisesRegex(RuntimeError, "legacy identity"):
            MODULE.plan_episode_drafts(
                [MODULE.canonical_episode_from_row(row("2362307285"))],
                legacy_collision,
                max_creates=1,
            )
        self.assertEqual(legacy_collision.create_calls, [])

    def test_canonical_strapi_configuration_is_fixed_and_unambiguous(self):
        client = MODULE.canonical_strapi_client(
            {
                "STRAPI_MANAGEMENT_URL": "http://127.0.0.1:1337",
                "STRAPI_URL": "http://127.0.0.1:1337/",
                "STRAPI_MANAGEMENT_TOKEN": "opaque-test-token",
                "STRAPI_API_TOKEN": "opaque-test-token",
            }
        )
        self.assertEqual(client.base_url, "http://127.0.0.1:1337")
        with self.assertRaises(RuntimeError):
            MODULE.canonical_strapi_client(
                {"STRAPI_MANAGEMENT_URL": "https://strapi.example.test", "STRAPI_MANAGEMENT_TOKEN": "token"}
            )
        with self.assertRaises(RuntimeError):
            MODULE.canonical_strapi_client(
                {
                    "STRAPI_MANAGEMENT_URL": "http://127.0.0.1:1337",
                    "STRAPI_MANAGEMENT_TOKEN": "one",
                    "STRAPI_API_TOKEN": "two",
                }
            )

    def test_published_or_scheduled_create_response_fails_verification(self):
        class UnsafeClient(FakeClient):
            def create_episode(self, data):
                record = super().create_episode(data)
                record["publishedAt"] = "2026-07-29T12:00:00Z"
                return record

        with self.assertRaises(RuntimeError):
            MODULE.synchronize_episode_drafts(
                Connection([row("2362307285")]),
                UnsafeClient(),
                apply=True,
                confirmation=MODULE.APPLY_CONFIRMATION,
            )


if __name__ == "__main__":
    unittest.main()
