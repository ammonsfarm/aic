import importlib.util
import hashlib
import io
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

PSYCOPG_STUB = types.ModuleType("psycopg")
PSYCOPG_ROWS_STUB = types.ModuleType("psycopg.rows")
PSYCOPG_ROWS_STUB.dict_row = object()
sys.modules.setdefault("psycopg", PSYCOPG_STUB)
sys.modules.setdefault("psycopg.rows", PSYCOPG_ROWS_STUB)

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "pastorwood_cutover_import.py"
SPEC = importlib.util.spec_from_file_location("pastorwood_cutover_import", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class CutoverIdentityTests(unittest.TestCase):
    def test_cache_invalidation_uses_only_the_canonical_loopback_and_generic_payload(self):
        captured = {}

        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self, limit):
                self.limit = limit
                return b'{"revalidated":true}'

        def opener(request, timeout):
            captured["url"] = request.full_url
            captured["authorization"] = request.get_header("Authorization")
            captured["payload"] = json.loads(request.data)
            captured["timeout"] = timeout
            return Response()

        previous = os.environ.get("STRAPI_REVALIDATE_URL")
        os.environ["STRAPI_REVALIDATE_URL"] = "https://attacker.invalid/collect"
        try:
            MODULE.request_public_cache_invalidation("a" * 64, urlopen=opener)
        finally:
            if previous is None:
                os.environ.pop("STRAPI_REVALIDATE_URL", None)
            else:
                os.environ["STRAPI_REVALIDATE_URL"] = previous

        self.assertEqual(captured, {
            "url": "http://127.0.0.1:8087/api/revalidate/strapi",
            "authorization": f"Bearer {'a' * 64}",
            "payload": {"event": "entry.publish", "source": "pastorwood-cutover"},
            "timeout": 10,
        })

    def test_publication_manifest_binds_pending_invalidation_to_exact_actions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "publications.json"
            actions = {
                "post:7": {
                    "key": "post:7",
                    "kind": "post",
                    "identity": "7",
                    "action": "published",
                    "documentId": "post-document",
                    "recordedAt": "2026-07-23T00:00:00Z",
                    "sequence": 1,
                },
            }
            verification = {"files": 2, "sha256": "b" * 64}
            MODULE.write_publication_manifest(
                path,
                "plan-fingerprint",
                "c" * 64,
                verification,
                actions,
                [],
                "pending",
            )
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(payload["cacheInvalidation"]["state"], "pending")
            self.assertEqual(
                payload["cacheInvalidation"]["actionsFingerprint"],
                MODULE.stable_fingerprint([actions["post:7"]]),
            )
            loaded_actions, state = MODULE.load_publication_manifest(
                path,
                "plan-fingerprint",
                "c" * 64,
                verification,
            )
            self.assertEqual(loaded_actions, actions)
            self.assertEqual(state, "pending")

            payload["actions"][0]["documentId"] = "tampered-document"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "cache-invalidation evidence"):
                MODULE.load_publication_manifest(path, "plan-fingerprint", "c" * 64, verification)

    def test_legacy_publication_evidence_is_pending_until_explicitly_invalidated(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "publications.json"
            verification = {"files": 0}
            path.write_text(json.dumps({
                "version": 1,
                "planFingerprint": "plan-fingerprint",
                "mutationManifestSha256": "d" * 64,
                "publicMediaVerification": verification,
                "actions": [{
                    "key": "page:home",
                    "action": "published",
                    "recordedAt": "2026-07-23T00:00:00Z",
                    "sequence": 1,
                }],
                "exclusions": [],
            }), encoding="utf-8")

            actions, state = MODULE.load_publication_manifest(
                path,
                "plan-fingerprint",
                "d" * 64,
                verification,
            )
            self.assertEqual(set(actions), {"page:home"})
            self.assertEqual(state, "pending")

    def _complete_attestation_fixture(self, directory):
        root = Path(directory)
        plan_fingerprint = "a" * 64
        mutation_sha256 = "b" * 64
        publication_manifest = root / "publications.json"
        expected_entries = {
            "post:7": {"key": "post:7", "action": "publish"},
            "redirect:/old/": {"key": "redirect:/old/", "action": "activate"},
        }
        actions = {
            "post:7": {
                "key": "post:7", "kind": "post", "identity": "7", "action": "published",
                "documentId": "post-doc", "recordedAt": "2026-07-23T00:00:00Z", "sequence": 1,
            },
            "redirect:/old/": {
                "key": "redirect:/old/", "kind": "redirect", "identity": "/old/", "action": "activated",
                "documentId": "redirect-doc", "recordedAt": "2026-07-23T00:00:01Z", "sequence": 2,
            },
        }
        MODULE.write_publication_manifest(
            publication_manifest,
            plan_fingerprint,
            mutation_sha256,
            {"verifiedFiles": 0, "verifiedBytes": 0, "evidenceFingerprint": "c" * 64},
            actions,
            [],
            "complete",
        )
        failure_evidence = {"planFingerprint": plan_fingerprint, "failures": []}
        return plan_fingerprint, mutation_sha256, publication_manifest, expected_entries, actions, failure_evidence

    def test_complete_phase_two_writes_atomic_bound_attestation_and_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = self._complete_attestation_fixture(directory)
            plan, mutation, manifest, entries, actions, failures = fixture
            attestation = MODULE.build_cutover_attestation(
                plan_fingerprint=plan,
                mutation_manifest_sha256=mutation,
                expected_entries=entries,
                publication_actions=actions,
                publication_manifest=manifest,
                cache_invalidation_state="complete",
                verified_redirect_keys={"redirect:/old/"},
                failure_evidence=failures,
                git_revision="d" * 40,
                completed_at="2026-07-23T00:00:02Z",
            )
            output = Path(directory) / MODULE.DEFAULT_CUTOVER_ATTESTATION.name
            digest = MODULE.write_cutover_attestation_pair(attestation, output, allow_test_output=True)

            self.assertEqual(hashlib.sha256(output.read_bytes()).hexdigest(), digest)
            self.assertEqual(
                Path(f"{output}.sha256").read_text(encoding="ascii"),
                f"{digest}  {output.name}\n",
            )
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), attestation)
            self.assertEqual(list(Path(directory).glob(".*.tmp")), [])
            self.assertTrue(attestation["redirectActivation"]["activatedLast"])
            self.assertEqual(attestation["cacheInvalidation"]["state"], "complete")

    def test_attestation_is_never_built_for_partial_redirect_cache_or_failure_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            plan, mutation, manifest, entries, actions, failures = self._complete_attestation_fixture(directory)
            common = dict(
                plan_fingerprint=plan,
                mutation_manifest_sha256=mutation,
                expected_entries=entries,
                publication_manifest=manifest,
                git_revision="d" * 40,
            )
            with self.assertRaisesRegex(RuntimeError, "partial reviewed publication"):
                MODULE.build_cutover_attestation(
                    **common,
                    publication_actions={"post:7": actions["post:7"]},
                    cache_invalidation_state="complete",
                    verified_redirect_keys=set(),
                    failure_evidence=failures,
                )
            with self.assertRaisesRegex(RuntimeError, "redirect activation verification"):
                MODULE.build_cutover_attestation(
                    **common,
                    publication_actions=actions,
                    cache_invalidation_state="complete",
                    verified_redirect_keys=set(),
                    failure_evidence=failures,
                )
            with self.assertRaisesRegex(RuntimeError, "pending cache invalidation"):
                MODULE.build_cutover_attestation(
                    **common,
                    publication_actions=actions,
                    cache_invalidation_state="pending",
                    verified_redirect_keys={"redirect:/old/"},
                    failure_evidence=failures,
                )
            with self.assertRaisesRegex(RuntimeError, "failure evidence"):
                MODULE.build_cutover_attestation(
                    **common,
                    publication_actions=actions,
                    cache_invalidation_state="complete",
                    verified_redirect_keys={"redirect:/old/"},
                    failure_evidence={"planFingerprint": plan, "failures": [{"key": "post:7"}]},
                )
            self.assertFalse((Path(directory) / MODULE.DEFAULT_CUTOVER_ATTESTATION.name).exists())

    def test_attestation_output_rejects_noncanonical_production_and_symlink_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "wrong-name.json"
            with self.assertRaisesRegex(RuntimeError, "output path"):
                MODULE.write_cutover_attestation_pair({}, output, allow_test_output=True)
            canonical_name = Path(directory) / MODULE.DEFAULT_CUTOVER_ATTESTATION.name
            with self.assertRaisesRegex(RuntimeError, "immutable migration root"):
                MODULE.write_cutover_attestation_pair({}, canonical_name)
            target = Path(directory) / "target.json"
            target.write_text("{}", encoding="utf-8")
            canonical_name.symlink_to(target)
            with self.assertRaisesRegex(RuntimeError, "non-symlink"):
                MODULE.write_cutover_attestation_pair({}, canonical_name, allow_test_output=True)

    def test_verified_snapshot_is_the_only_production_wordpress_source(self):
        args = MODULE.parse_args([])
        self.assertEqual(args.wordpress_source, "verified-snapshot")
        self.assertEqual(args.wordpress_rest_snapshot, MODULE.DEFAULT_WORDPRESS_SNAPSHOT)
        self.assertEqual(args.reviewed_mutation_manifest_sha256, "")
        with mock.patch.dict(os.environ, {
            "NODE_ENV": "production",
            MODULE.DIRECT_WORDPRESS_REFRESH_TEST_MODE_ENV: "1",
        }), mock.patch.object(sys, "stderr", io.StringIO()):
            with self.assertRaises(SystemExit):
                MODULE.parse_args(["--wordpress-source", "direct-database-refresh"])
            with self.assertRaisesRegex(RuntimeError, "unavailable outside explicit non-production test mode"):
                MODULE.fetch_wordpress_direct_refresh(SimpleNamespace(
                    wordpress_source="direct-database-refresh",
                    confirm_wordpress_refresh=MODULE.WORDPRESS_REFRESH_CONFIRMATION,
                ))

    def test_direct_wordpress_source_exists_only_in_explicit_test_mode(self):
        with mock.patch.dict(os.environ, {
            "NODE_ENV": "test",
            MODULE.DIRECT_WORDPRESS_REFRESH_TEST_MODE_ENV: "1",
        }):
            args = MODULE.parse_args([
                "--wordpress-source",
                "direct-database-refresh",
                "--confirm-wordpress-refresh",
                MODULE.WORDPRESS_REFRESH_CONFIRMATION,
            ])
        self.assertEqual(args.wordpress_source, "direct-database-refresh")
        self.assertEqual(args.confirm_wordpress_refresh, MODULE.WORDPRESS_REFRESH_CONFIRMATION)

    def test_cutover_upsert_uses_editorial_draft_workflow_without_direct_publish(self):
        client = MODULE.StrapiClient("http://127.0.0.1:1337", "token")
        calls = []

        def request(path, method="GET", payload=None):
            calls.append((path, method, payload))
            if path.startswith("/api/posts?"):
                return {"data": [{"documentId": "doc-1", "legacyId": "7", "updatedAt": "2026-07-22T10:00:00Z"}]}
            if path.endswith("/baseline"):
                return {"data": {"documentId": "doc-1"}, "adopted": True}
            return {"data": {"documentId": "doc-1", "legacyId": "7", "updatedAt": "2026-07-22T10:01:00Z"}}

        client.request = request
        result = client.upsert(
            "posts",
            "legacyId",
            "7",
            {
                "legacyId": "7",
                "title": "Reviewed",
                "scheduledFor": "2026-07-22T09:00:00Z",
            },
        )

        self.assertEqual(result["outcome"], "updated")
        self.assertTrue(any(path == "/api/editorial/post/doc-1/baseline" for path, _method, _payload in calls))
        self.assertTrue(any(path == "/api/editorial/post/doc-1" and method == "PUT" for path, method, _payload in calls))
        self.assertFalse(any("status=published" in path for path, _method, _payload in calls))
        update_payload = next(
            payload
            for path, method, payload in calls
            if path == "/api/editorial/post/doc-1" and method == "PUT"
        )
        self.assertIsNone(update_payload["data"]["scheduledFor"])

    def test_apply_requires_complete_media_rehearsal_flags(self):
        self.assertEqual(MODULE.main(["--apply"]), 1)

    def test_numeric_database_id_is_a_stable_text_identity(self):
        self.assertEqual(MODULE.text(14759), "14759")

    def test_legacy_content_cleanup_keeps_inner_copy_and_rewrites_public_uploads(self):
        raw = '''<!-- wp:html --><script>alert(1)</script>[et_pb_text admin_label="Body"]<p onclick="bad()">Read <a href="javascript:bad()">this</a>.</p><img src="https://www.pastorwood.org/wp-content/uploads/2024/01/photo.jpg">[/et_pb_text]'''

        cleaned = MODULE.clean_legacy_content(raw)

        self.assertIn("<p>Read <a>this</a>.</p>", cleaned)
        self.assertIn('/media/legacy/2024/01/photo.jpg', cleaned)
        self.assertNotIn("et_pb", cleaned)
        self.assertNotIn("script", cleaned)
        self.assertNotIn("onclick", cleaned)

    def test_malformed_upload_punctuation_is_normalized_without_a_broken_public_path(self):
        raw = '<img src="https://www.pastorwood.org/wp-content/uploads/2024/photo.jpg)">'
        cleaned = MODULE.clean_legacy_content(raw)
        references = MODULE.extract_upload_references([{
            "type": "page", "id": "7", "content": raw, "excerpt": "", "meta": {},
        }])

        self.assertEqual(cleaned, '<img src="/media/legacy/2024/photo.jpg">')
        self.assertEqual(references, {"2024/photo.jpg": {"page:7"}})
        self.assertIsNone(MODULE.safe_upload_relative_path("2024/photo.jpg)"))

    def test_unsafe_encoded_upload_delimiters_are_preserved_reported_and_blocking(self):
        for encoded_name in ("foo.jpg%29", "foo%3Fmissing.jpg", "foo%23missing.jpg"):
            with self.subTest(encoded_name=encoded_name):
                source_url = f"https://www.pastorwood.org/wp-content/uploads/{encoded_name}"
                cleaned = MODULE.clean_legacy_content(f'<img src="{source_url}">')
                rejected = []
                references = MODULE.extract_final_payload_upload_references(
                    {"post": [{"legacyId": "7", "body": cleaned}]},
                    rejected,
                )
                coverage = MODULE.build_media_reference_coverage(
                    references, [], {}, {}, "", "a" * 64, rejected, True,
                )

                self.assertIn(source_url, cleaned)
                self.assertNotIn('src=""', cleaned)
                self.assertEqual(references, {})
                self.assertEqual(rejected[0]["rawSource"], source_url)
                with self.assertRaisesRegex(RuntimeError, "coverage is incomplete"):
                    MODULE.validate_media_reference_coverage(coverage)

    def test_legacy_content_cleanup_preserves_authored_bracketed_copy(self):
        authored = "Though [Jesus] was God's Son. [Jesus said,] obey. [do this thing] and compare [2:6]."
        raw = f'[et_pb_text admin_label="Body"]<p>{authored}</p>[/et_pb_text]'

        self.assertIn(authored, MODULE.clean_legacy_content(raw))
        self.assertIn("[Jesus]", MODULE.strip_markup(raw))
        self.assertIn("[Jesus said,]", MODULE.strip_markup(raw))
        self.assertIn("[do this thing]", MODULE.strip_markup(raw))
        self.assertIn("[2:6]", MODULE.strip_markup(raw))

    def test_legacy_content_cleanup_rewrites_only_verified_external_images(self):
        source = "https://gallery.mailchimp.com/example/image.jpg?one=1&two=2"
        public_path = "/media/legacy/pastorwood-import/external-images/image.jpg"
        raw = f'<p><img src="{source.replace("&", "&amp;")}"><img src="https://images.example/unverified.jpg"></p>'

        cleaned = MODULE.clean_legacy_content(raw, {source: public_path})

        self.assertIn(public_path, cleaned)
        self.assertNotIn("gallery.mailchimp.com", cleaned)
        self.assertIn("https://images.example/unverified.jpg", cleaned)

    def test_page_import_excludes_operational_and_contentless_pages(self):
        pages, excluded = MODULE.build_pages([
            {"id": "1", "type": "page", "slug": "donation-confirmation", "title": "Thank you", "content": "paid", "excerpt": "", "meta": {}},
            {"id": "2", "type": "page", "slug": "blank", "title": "", "content": "[et_pb_section][/et_pb_section]", "excerpt": "", "meta": {}},
            {"id": "3", "type": "page", "slug": "ministry", "title": "Ministry", "content": "[et_pb_text]<p>Welcome</p>[/et_pb_text]", "excerpt": "", "meta": {}},
        ])

        self.assertEqual([page["legacyId"] for page in pages], ["3"])
        self.assertEqual({item["reason"] for item in excluded}, {"operational-or-commerce-page", "contentless-page"})

    def test_episode_matching_is_one_to_one_and_aic_canonical(self):
        aic = [
            {"trackId": "track-1", "title": "Best Of: Life of Prayer, Part 1", "publishDate": "2024-01-02", "sourceFile": "track-1.json"},
            {"trackId": "track-2", "title": "A Different Broadcast", "publishDate": "2024-01-03", "sourceFile": "track-2.json"},
        ]
        wordpress = [{"id": "91", "title": "Life of Prayer - Part One", "date": "2024-01-02 10:00:00", "meta": {"sermon_date": "1704153600"}}]

        matches = MODULE.match_episodes(aic, wordpress)

        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].aic_track_id, "track-1")
        self.assertEqual(matches[0].wp_sermon_id, "91")

    def test_aic_episode_uses_same_origin_public_audio_route(self):
        episodes, _ = MODULE.build_episodes([], [{"trackId": 1003386838, "title": "Program", "publishDate": "2024-01-01", "sourceFile": "1003386838.mp3", "detail": ""}])
        self.assertEqual(episodes[0]["externalAudioUrl"], "/media/episodes/1003386838")

    def test_public_episode_media_urls_share_the_full_safe_track_id_contract(self):
        expected = {
            "1003386838": "/media/episodes/1003386838",
            "sa_99151132260": "/media/episodes/sa_99151132260",
            "wp-sermon:14759": "/media/episodes/wp-sermon%3A14759",
            "cms_sunday_20260722": "/media/episodes/cms_sunday_20260722",
        }
        for track_id, public_url in expected.items():
            with self.subTest(track_id=track_id):
                self.assertEqual(MODULE.public_episode_media_url(track_id), public_url)
                self.assertEqual(MODULE.public_episode_track_id_from_url(public_url), track_id)
        for unsafe in [
            "/media/episodes/../secret",
            "/media/episodes/cms_%252fsecret",
            "/media/episodes/wp-sermon%3Abad",
            "https://evil.example/media/episodes/100",
        ]:
            with self.subTest(unsafe=unsafe):
                self.assertEqual(MODULE.public_episode_track_id_from_url(unsafe), "")

    def test_build_episodes_imports_genuinely_unique_wordpress_sermon(self):
        aic = [{"trackId": "canonical", "title": "Canonical Episode", "publishDate": "2024-04-05", "sourceFile": "canonical.json", "detail": ""}]
        wordpress = [{"id": "12", "type": "wpfc_sermon", "title": "Unmatched Legacy Title", "slug": "unmatched-legacy-title", "date": "2020-01-01 00:00:00", "meta": {}}]

        reconciliation = []
        episodes, matches = MODULE.build_episodes(wordpress, aic, reconciliation)

        self.assertEqual({episode["trackId"] for episode in episodes}, {"canonical", "wp-sermon:12"})
        self.assertEqual(matches, [])
        self.assertEqual(reconciliation[0]["status"], "imported-unique")

    def test_episode_audio_sha256_dedupes_renamed_cross_set_and_residual_replays(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sermons").mkdir()
            payload = (b"verified identical sermon audio" * 10000)
            (root / "sermons" / "canonical.mp3").write_bytes(payload)
            (root / "sermons" / "renamed.mp3").write_bytes(payload)
            (root / "sermons" / "replay.mp3").write_bytes(payload)
            sermons = [
                {"id": "1", "type": "wpfc_sermon", "title": "Canonical Program", "slug": "canonical", "date": "2024-01-01", "meta": {"sermon_audio": "/wp-content/uploads/sermons/canonical.mp3"}},
                {"id": "2", "type": "wpfc_sermon", "title": "Renamed Replay", "slug": "renamed", "date": "2024-02-01", "meta": {"sermon_audio": "/wp-content/uploads/sermons/renamed.mp3"}},
                {"id": "3", "type": "wpfc_sermon", "title": "Another Replay", "slug": "replay", "date": "2024-03-01", "meta": {"sermon_audio": "/wp-content/uploads/sermons/replay.mp3"}},
            ]
            aic = [{"trackId": "100", "title": "Canonical Program", "publishDate": "2024-01-01", "sourceFile": "100.mp3", "detail": ""}]
            reconciliation = []
            report = {}

            episodes, matches = MODULE.build_episodes(sermons, aic, reconciliation, root, True, report)

            self.assertEqual([(match.aic_track_id, match.wp_sermon_id) for match in matches], [("100", "1")])
            self.assertEqual([episode["trackId"] for episode in episodes], ["100"])
            duplicates = {row["wpSermonId"]: row for row in reconciliation}
            self.assertEqual(duplicates["2"]["reason"], "aic-audio-content-sha256")
            self.assertEqual(duplicates["3"]["reason"], "aic-audio-content-sha256")
            self.assertRegex(duplicates["2"]["audioContentSha256"], r"^[a-f0-9]{64}$")
            self.assertEqual(report["fullHashedPaths"], 3)

    def test_baseline_episode_identity_is_preserved_when_rest_copy_changes_title(self):
        aic = [
            {"trackId": "100", "title": "Original Program", "publishDate": "2024-01-01", "sourceFile": "100.mp3", "detail": ""},
            {"trackId": "200", "title": "Changed Program", "publishDate": "2024-01-01", "sourceFile": "200.mp3", "detail": ""},
        ]
        baseline = [{"id": "10", "type": "wpfc_sermon", "title": "Original Program", "slug": "original", "date": "2024-01-01", "meta": {}}]
        merged = [{"id": "10", "type": "wpfc_sermon", "title": "Changed Program", "slug": "changed", "date": "2024-01-01", "meta": {}}]

        _episodes, matches = MODULE.build_episodes(merged, aic, baseline_wp_content=baseline)

        self.assertEqual([(match.aic_track_id, match.wp_sermon_id) for match in matches], [("100", "10")])

    def test_rest_only_explicit_bestof_replay_aliases_to_existing_aic_episode(self):
        aic = [{"trackId": "100", "title": "Faithful Life", "publishDate": "2024-01-01", "sourceFile": "100.mp3", "detail": ""}]
        baseline = [{"id": "10", "type": "wpfc_sermon", "title": "Faithful Life", "slug": "faithful-life", "date": "2024-01-01", "meta": {}}]
        merged = [
            *baseline,
            {"id": "11", "type": "wpfc_sermon", "title": "Faithful Life", "slug": "faithful-life-bestof", "date": "2025-01-01", "meta": {"sermon_audio": "/wp-content/uploads/2025/faithful-life-bestof.mp3"}},
        ]
        reconciliation = []

        episodes, _matches = MODULE.build_episodes(merged, aic, reconciliation, baseline_wp_content=baseline)

        self.assertEqual([episode["trackId"] for episode in episodes], ["100"])
        self.assertEqual(reconciliation[0]["wpSermonId"], "11")
        self.assertEqual(reconciliation[0]["reason"], "explicit-bestof-canonical-title")
        self.assertEqual(reconciliation[0]["canonicalTrackId"], "100")

    def test_wordpress_rest_merge_preserves_database_only_plugin_meta(self):
        database_content = [{"id": 1, "type": "post", "title": "Old", "meta": {"_aioseo_title": "SEO", "shared": "db"}}]
        rest_content = [{"id": 1, "type": "post", "title": "Current", "meta": {"shared": "rest"}}, {"id": 2, "type": "post", "title": "New", "meta": {}}]
        database_media = [{"id": 10, "title": "Old media", "meta": {"_wp_attachment_image_alt": "Alt", "shared": "db"}}]
        rest_media = [{"id": 10, "title": "Current media", "meta": {"shared": "rest"}}, {"id": 11, "title": "New media", "meta": {}}]

        content, media, report = MODULE.merge_wordpress_sources(database_content, database_media, rest_content, rest_media)

        self.assertEqual(content[0]["title"], "Current")
        self.assertEqual(content[0]["meta"], {"_aioseo_title": "SEO", "shared": "rest"})
        self.assertEqual(media[0]["meta"], {"_wp_attachment_image_alt": "Alt", "shared": "rest"})
        self.assertEqual(report["restOnlyContentCounts"], {"post": 1})
        self.assertEqual(report["restOnlyMediaIds"], ["11"])

    def test_extra_wordpress_copy_of_aic_episode_is_reported_not_imported(self):
        aic = [{"trackId": "canonical", "title": "Same Episode", "publishDate": "2024-04-05", "sourceFile": "canonical.json", "detail": ""}]
        wordpress = [
            {"id": "12", "type": "wpfc_sermon", "title": "Same Episode", "slug": "same-episode", "date": "2024-04-05 00:00:00", "meta": {}},
            {"id": "13", "type": "wpfc_sermon", "title": "Same Episode", "slug": "same-episode-copy", "date": "2024-04-05 00:00:00", "meta": {}},
        ]
        reconciliation = []

        episodes, matches = MODULE.build_episodes(wordpress, aic, reconciliation)

        self.assertEqual(len(episodes), 1)
        self.assertEqual(len(matches), 1)
        self.assertEqual(reconciliation[0]["status"], "duplicate-aic")

    def test_aic_post_wins_over_wordpress_same_identity(self):
        wordpress = [{
            "id": "7", "type": "post", "title": "Old title", "slug": "same-post",
            "date": "2024-03-01 10:00:00", "dateGmt": "2024-03-01 15:00:00",
            "content": "old", "excerpt": "", "categories": ["weekly-devotional"], "meta": {},
        }]
        aic = [{
            "postId": "7", "sourceType": "pastorwood_devotional", "title": "Current title",
            "slug": "same-post", "sourceUrl": "https://www.pastorwood.org/2024/03/same-post/",
            "publishDate": "2024-03-01", "contentHtml": "current", "summary": "current summary",
        }]

        posts = MODULE.build_posts(wordpress, aic)

        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["title"], "Current title")
        self.assertEqual(posts[0]["body"], "current")

    def test_distinct_numeric_aic_post_ids_never_collapse(self):
        rows = [
            {"postId": 16494, "sourceType": "pastorwood_devotional", "title": "One", "slug": "one", "sourceUrl": "https://www.pastorwood.org/one/", "contentHtml": "one"},
            {"postId": 16497, "sourceType": "pastorwood_devotional", "title": "Two", "slug": "two", "sourceUrl": "https://www.pastorwood.org/two/", "contentHtml": "two"},
        ]
        reconciliation = []

        posts = MODULE.build_posts([], rows, [], reconciliation)

        self.assertEqual({post["legacyId"] for post in posts}, {"16494", "16497"})
        self.assertTrue(all(row["status"] == "aic-only-added" for row in reconciliation))

    def test_source_fingerprint_uses_final_collision_safe_slug(self):
        wordpress = [
            {"id": "1", "type": "post", "title": "Same", "slug": "same", "date": "2024-01-01", "dateGmt": "2024-01-01", "content": "one", "excerpt": "", "categories": [], "meta": {}},
            {"id": "2", "type": "post", "title": "Same", "slug": "same", "date": "2024-01-02", "dateGmt": "2024-01-02", "content": "two", "excerpt": "", "categories": [], "meta": {}},
        ]

        posts = MODULE.build_posts(wordpress, [])

        self.assertEqual(len({post["slug"] for post in posts}), 2)
        for post in posts:
            fingerprint = post["sourceFingerprint"]
            copy = {**post, "sourceFingerprint": ""}
            self.assertEqual(fingerprint, MODULE.stable_fingerprint(copy))

    def test_checkpoint_fails_closed_when_plan_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Path(directory) / "checkpoint.json"
            checkpoint.write_text('{"version":2,"planFingerprint":"old","completed":["post:1"]}', encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "different source plan"):
                MODULE.load_checkpoint(checkpoint, "new")

    def test_people_and_endorsements_are_extracted_from_divi_shortcodes(self):
        rows = [{
            "id": "8", "type": "page", "slug": "board-members",
            "content": '[et_pb_team_member name="Jane Doe" position="Chair" image_url="https://www.pastorwood.org/wp-content/uploads/jane.jpg"]<p>Serves faithfully.</p>[/et_pb_team_member][et_pb_testimonial author="John Smith" job_title="Pastor"]A sufficiently long endorsement quote for import.[/et_pb_testimonial]',
        }]

        people, endorsements = MODULE.build_people_and_endorsements(rows)

        self.assertEqual(people[0]["name"], "Jane Doe")
        self.assertEqual(people[0]["roles"], ["board"])
        self.assertEqual(endorsements[0]["attribution"], "John Smith")

    def test_people_and_endorsements_are_extracted_from_rendered_divi_html(self):
        board = {
            "id": "159", "type": "page", "slug": "board-members",
            "content": '''
                <div class="et_pb_module et_pb_image"><span class="et_pb_image_wrap"><img src="https://www.pastorwood.org/wp-content/uploads/jane.jpg" title="Jane"></span></div>
                <div class="et_pb_module et_pb_team_member et_pb_team_member_no_image clearfix">
                  <div class="et_pb_team_member_description">
                    <h4 class="et_pb_module_header">Jane Doe</h4>
                    <p class="et_pb_member_position">Chair</p>
                    <div><p>Serves the ministry faithfully.<br>Lives in Atlanta.</p></div>
                  </div>
                </div>
            ''',
        }
        testimonials = {
            "id": "213", "type": "page", "slug": "endorsements",
            "content": '''
                <div class="et_pb_module et_pb_testimonial clearfix">
                  <div class="et_pb_testimonial_description">
                    <div class="et_pb_testimonial_content"><p>A sufficiently long rendered endorsement quote for import.</p></div>
                    <span class="et_pb_testimonial_author">John Smith</span>
                    <span class="et_pb_testimonial_position">Senior Pastor</span>
                    <span class="et_pb_testimonial_company"><a href="https://example.org">Example Church</a></span>
                  </div>
                </div>
                <div class="et_pb_module et_pb_testimonial clearfix">
                  <div class="et_pb_testimonial_description">
                    <div class="et_pb_testimonial_content"><iframe src="//docs.google.com/viewer?url=https%3A%2F%2Fwww.pastorwood.org%2Fwp-content%2Fuploads%2Frecommendation.pdf&amp;embedded=true"></iframe></div>
                    <span class="et_pb_testimonial_author">Document Author</span>
                  </div>
                </div>
            ''',
        }
        exclusions = []
        coverage = {}

        people, endorsements = MODULE.build_people_and_endorsements([board, testimonials], exclusions, coverage)

        self.assertEqual(len(people), 1)
        self.assertEqual(people[0]["name"], "Jane Doe")
        self.assertEqual(people[0]["title"], "Chair")
        self.assertEqual(people[0]["biography"], "Serves the ministry faithfully. Lives in Atlanta.")
        self.assertEqual(people[0]["legacyPhotoUrl"], "/media/legacy/jane.jpg")
        self.assertEqual(len(endorsements), 1)
        self.assertEqual(endorsements[0]["attribution"], "John Smith")
        self.assertEqual(endorsements[0]["organization"], "Example Church")
        self.assertEqual(exclusions, [{
            "legacyId": "wp-page:213:endorsement-rendered:2",
            "attribution": "Document Author",
            "documentUrl": "https://www.pastorwood.org/wp-content/uploads/recommendation.pdf",
            "reason": "document-only-no-textual-quote",
        }])
        self.assertEqual(coverage["people"]["encountered"], 1)
        self.assertEqual(coverage["people"]["imported"], 1)
        self.assertEqual(coverage["endorsements"]["encountered"], 2)
        self.assertEqual(coverage["endorsements"]["imported"], 1)
        self.assertEqual(coverage["endorsements"]["excluded"], 1)
        self.assertEqual(coverage["endorsements"]["blockingExclusions"], [])

    def test_rendered_divi_text_preserves_inline_punctuation_and_block_boundaries(self):
        _, testimonials = MODULE.divi_rendered_structured_content('''
            <div class="et_pb_module et_pb_testimonial">
              <div class="et_pb_testimonial_content"><p>Read <em>Three Questions</em>.</p><p>Second block.</p></div>
              <span class="et_pb_testimonial_author">Reader</span>
            </div>
        ''')

        self.assertEqual(testimonials[0]["quote"], "Read Three Questions. Second block.")

    def test_malformed_rendered_structured_modules_are_blocking_and_never_silent(self):
        rows = [{
            "id": "159", "type": "page", "slug": "board-members",
            "content": '''
              <div class="et_pb_module et_pb_team_member"><div class="et_pb_team_member_description"><p>Biography without a name.</p></div></div>
              <div class="et_pb_module et_pb_testimonial"><div class="et_pb_testimonial_content">A sufficiently long quote without attribution.</div></div>
              <div class="et_pb_module et_pb_testimonial"><div class="et_pb_testimonial_content">Too short.</div><span class="et_pb_testimonial_author">Named Author</span></div>
            ''',
        }]
        exclusions = []
        coverage = {}

        people, endorsements = MODULE.build_people_and_endorsements(rows, exclusions, coverage)

        self.assertEqual(people, [])
        self.assertEqual(endorsements, [])
        self.assertEqual(coverage["people"]["encountered"], 1)
        self.assertEqual(coverage["people"]["blockingExclusions"][0]["reason"], "missing-name")
        self.assertEqual(coverage["endorsements"]["encountered"], 2)
        self.assertEqual(
            {record["reason"] for record in coverage["endorsements"]["blockingExclusions"]},
            {"missing-attribution", "insufficient-text-no-document"},
        )
        self.assertEqual({record["reason"] for record in exclusions}, {"missing-attribution", "insufficient-text-no-document"})

    def test_apply_preflight_blocks_unresolved_structured_extraction(self):
        imported_person = {"status": "imported"}
        malformed_endorsement = {"status": "excluded", "reason": "missing-attribution"}
        plan = {
            "episodeAudioCoverage": {
                "enabled": True, "objects": 0, "aicTrackIds": 0,
                "missing": [], "orphanObjects": [], "zeroByteObjectIds": [], "invalidObjectIds": [],
            },
            "wordpressRestSnapshot": {"consistencyPasses": 2, "sha256": "a" * 64, "restOnlyMediaIds": []},
            "wordpressRestMediaBackup": {"enabled": True, "missingMediaIds": [], "verifiedFiles": 0},
            "externalImageBackup": {
                "enabled": True, "missingSourceUrls": [], "verifiedFiles": 0, "expectedFiles": 0,
                "verifiedReferences": 0, "expectedReferences": 0,
            },
            "episodeAudioDeduplication": {"enabled": True},
            "redirectIntegrity": {"selfLoops": 0, "reservedSources": 0, "nonexistentMediaTargets": 0},
            "redirectFailures": [],
            "plannedCounts": {"people": 1, "endorsements": 0},
            "structuredContentCoverage": {
                "people": {
                    "encountered": 1, "imported": 1, "deduplicated": 0, "excluded": 0,
                    "blockingExclusions": [], "records": [imported_person],
                },
                "endorsements": {
                    "encountered": 1, "imported": 0, "deduplicated": 0, "excluded": 1,
                    "blockingExclusions": [malformed_endorsement], "records": [malformed_endorsement],
                },
            },
            "excludedEndorsements": [malformed_endorsement],
            "mediaReferenceCoverage": {
                "enabled": True,
                "encountered": 0,
                "verifiedPublicFiles": 0,
                "verifiedReplacements": 0,
                "reviewedRemovals": 0,
                "unexpectedReviewedRemovals": [],
                "rejectedReferences": [],
                "blockingReferences": [],
                "records": [],
            },
            "finalMediaTargetAudit": {
                "enabled": True,
                "targets": 0,
                "verifiedTargets": 0,
                "blockingTargets": [],
                "invalidTargets": [],
                "records": [],
            },
        }

        with self.assertRaisesRegex(RuntimeError, "endorsements structured extraction coverage is incomplete"):
            MODULE.validate_apply_preflight(plan)


class CutoverBoundaryTests(unittest.TestCase):
    def test_external_image_manifest_requires_exact_snapshot_references_and_hashes(self):
        source_url = "https://gallery.mailchimp.com/example/image.jpg"
        snapshot_sha256 = "a" * 64
        payload = b"verified legacy image"
        digest = hashlib.sha256(payload).hexdigest()
        relative_path = f"pastorwood-import/external-images/{hashlib.sha256(source_url.encode('utf-8')).hexdigest()}.jpg"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_path = root / relative_path
            source_path.parent.mkdir(parents=True)
            source_path.write_bytes(payload)
            manifest_path = root / "external-images.json"
            manifest_path.write_text(json.dumps({
                "schemaVersion": 1,
                "snapshotSha256": snapshot_sha256,
                "destinationRoot": str(MODULE.DEFAULT_RESTRICTED_MEDIA_ROOT),
                "fileCount": 1,
                "referenceCount": 1,
                "totalBytes": len(payload),
                "records": [{
                    "sourceUrl": source_url,
                    "relativePath": relative_path,
                    "publicPath": f"/media/legacy/{relative_path}",
                    "contentType": "image/jpeg",
                    "sizeBytes": len(payload),
                    "sha256": digest,
                    "references": ["posts:7"],
                }],
            }), encoding="utf-8")

            evidence, paths, records = MODULE.verify_external_image_backup_manifest(
                manifest_path, snapshot_sha256, {source_url: {"posts:7"}}, root,
            )

        self.assertEqual(evidence["verifiedFiles"], 1)
        self.assertEqual(paths[source_url], f"/media/legacy/{relative_path}")
        self.assertEqual(records[0].visibility, "public")

    def test_radio_taxonomy_archive_maps_to_the_safe_canonical_radio_archive(self):
        target, reason = MODULE.redirect_target_for(
            "/radio/topics/covenant-community-church-galatians-2/",
            {},
            {"covenant-community-church-galatians-2": "/radio/episode/"},
            set(),
        )
        self.assertEqual(target, "/radio/")
        self.assertEqual(reason, "radio-taxonomy-archive-fallback")

    def test_external_media_merge_replaces_only_the_localized_synthetic_record(self):
        relative_path = "pastorwood-import/external-images/" + "a" * 64 + ".jpg"
        placeholder = MODULE.MediaRecord(
            "referenced-placeholder", "Image", relative_path,
            f"https://www.pastorwood.org/wp-content/uploads/{relative_path}",
            "image/jpeg", "public", ("post:wp-post:7",), True, 123,
        )
        external = MODULE.MediaRecord(
            "external-source", "Image", relative_path,
            "https://gallery.mailchimp.com/example.jpg",
            "image/jpeg", "public", ("posts:7",), True, 123,
        )

        merged = MODULE.merge_external_media_records([placeholder], [external])

        self.assertEqual(merged, [external])

    def test_external_media_merge_rejects_a_real_path_collision(self):
        relative_path = "pastorwood-import/external-images/" + "b" * 64 + ".jpg"
        attachment = MODULE.MediaRecord(
            "42", "Attachment", relative_path,
            f"https://www.pastorwood.org/wp-content/uploads/{relative_path}",
            "image/jpeg", "public", ("legacy-public-sitemap",), True, 123,
        )
        external = MODULE.MediaRecord(
            "external-source", "External", relative_path,
            "https://gallery.mailchimp.com/example.jpg",
            "image/jpeg", "public", ("posts:7",), True, 123,
        )

        with self.assertRaisesRegex(RuntimeError, relative_path):
            MODULE.merge_external_media_records([attachment], [external])

    def test_every_legacy_radio_taxonomy_family_maps_to_the_archive(self):
        for taxonomy in ("book", "preacher", "series", "topics", "service-type"):
            with self.subTest(taxonomy=taxonomy):
                target, reason = MODULE.redirect_target_for(f"/radio/{taxonomy}/legacy-value/", {}, {}, set())
                self.assertEqual((target, reason), ("/radio/", "radio-taxonomy-archive-fallback"))

    def test_public_media_copy_refuses_an_existing_different_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            restricted = root / "restricted"
            public = root / "public"
            (restricted / "2024").mkdir(parents=True)
            (public / "2024").mkdir(parents=True)
            (restricted / "2024" / "episode.mp3").write_bytes(b"source")
            (public / "2024" / "episode.mp3").write_bytes(b"different")
            record = MODULE.MediaRecord(
                "1", "Episode", "2024/episode.mp3", "https://www.pastorwood.org/wp-content/uploads/2024/episode.mp3",
                "audio/mpeg", "public", ("wpfc_sermon:1",), True, 6,
            )
            with self.assertRaisesRegex(RuntimeError, "checksum collision"):
                MODULE.copy_public_media(record, restricted, public)

    def test_media_path_rejects_traversal_and_private_operational_trees(self):
        bad_paths = [
            "../secret.txt",
            "/wp-content/uploads/gravity_forms/export.csv",
            "/wp-content/uploads/woocommerce_uploads/order.pdf",
            "/wp-content/uploads/logs/debug.log",
            "%2e%2e/private.txt",
            "https://www.pastorwood.org/wp-content/uploads/foo%3Fmissing.jpg",
            "https://www.pastorwood.org/wp-content/uploads/foo%23missing.jpg",
            "https://www.pastorwood.org/wp-content/uploads/folder%2Fother.jpg",
        ]
        for value in bad_paths:
            with self.subTest(value=value):
                self.assertIsNone(MODULE.safe_upload_relative_path(value))

        self.assertEqual(
            MODULE.safe_upload_relative_path("https://www.pastorwood.org/wp-content/uploads/sermons/2024/01/show.mp3"),
            "sermons/2024/01/show.mp3",
        )

    def test_missing_published_reference_stays_visible_and_blocks_without_review(self):
        references = MODULE.defaultdict(set)
        references["sermons/missing.mp3"].add("wpfc_sermon:4")
        with tempfile.TemporaryDirectory() as directory:
            records, rejected = MODULE.build_media_records([], [], [], references, Path(directory), True)

        self.assertEqual(rejected, [])
        self.assertEqual(len(records), 1)
        self.assertFalse(records[0].exists)
        coverage = MODULE.build_media_reference_coverage(
            references, records, {}, {}, "", "a" * 64, [], True,
        )
        self.assertEqual(coverage["blockingReferences"][0]["relativePath"], "sermons/missing.mp3")
        self.assertEqual(coverage["blockingReferences"][0]["classification"], "audio")
        self.assertEqual(coverage["blockingReferences"][0]["referencedBy"], ["wpfc_sermon:4"])
        with self.assertRaisesRegex(RuntimeError, "coverage is incomplete"):
            MODULE.validate_media_reference_coverage(coverage)

    def test_sitemap_only_missing_asset_can_be_explicitly_retired_without_a_redirect(self):
        record = MODULE.MediaRecord(
            "11", "Retired", "retired/file.pdf",
            "https://www.pastorwood.org/wp-content/uploads/retired/file.pdf",
            "application/pdf", "public", ("legacy-public-sitemap",), False, None,
        )
        fingerprint = "d" * 64
        coverage = MODULE.build_media_reference_coverage(
            MODULE.defaultdict(set),
            [record],
            {},
            {record.relative_path: ("legacy-public-sitemap",)},
            fingerprint,
            fingerprint,
            [],
            True,
        )

        MODULE.validate_media_reference_coverage(coverage)
        self.assertEqual(coverage["records"][0]["disposition"], "reviewed-reference-removal")
        redirects, failures, unmatched = MODULE.build_redirects(
            [record.source_url], [], [], [], [record],
        )
        self.assertEqual(redirects, [])
        self.assertEqual(failures, [])
        self.assertEqual(unmatched[0]["reason"], "private-or-unpublished-attachment")

    def test_aic_only_post_uploads_are_included_in_exact_reference_coverage(self):
        references = MODULE.extract_upload_references([{
            "postId": "16494",
            "sourceType": "pastorwood_devotional",
            "contentHtml": '<img src="https://www.pastorwood.org/wp-content/uploads/aic-only/photo.jpg">',
        }])

        self.assertEqual(references, {"aic-only/photo.jpg": {"pastorwood_devotional:16494"}})

    def test_final_payload_audit_catches_any_unverified_legacy_target(self):
        audit = MODULE.audit_final_public_media_targets(
            {"post": [{"legacyId": "7", "body": '<img src="/media/legacy/hidden/photo.jpg">'}]},
            [],
            True,
        )

        self.assertEqual(audit["blockingTargets"][0]["relativePath"], "hidden/photo.jpg")
        with self.assertRaisesRegex(RuntimeError, "final public payload"):
            MODULE.validate_final_public_media_targets(audit)

    def test_media_replacement_is_token_exact_and_final_episode_urls_are_validated(self):
        records = [{
            "legacyId": "7",
            "body": "/media/legacy/x.mp3 /media/legacy/x.mp3.backup",
        }]
        MODULE.apply_verified_media_replacements(
            (records,),
            {"x.mp3": "/media/episodes/wp-sermon%3A7"},
            set(),
        )

        self.assertIn("/media/episodes/wp-sermon%3A7", records[0]["body"])
        self.assertIn("/media/legacy/x.mp3.backup", records[0]["body"])
        self.assertNotIn("/media/episodes/wp-sermon%3A7.backup", records[0]["body"])

        invalid = MODULE.audit_final_public_media_targets(
            {"post": [{"legacyId": "8", "body": "/media/episodes/123.backup"}]},
            [],
            True,
        )
        with self.assertRaisesRegex(RuntimeError, "final public payload"):
            MODULE.validate_final_public_media_targets(invalid)

    def test_reviewed_removal_is_snapshot_bound_and_rewrites_the_broken_reference(self):
        snapshot_sha256 = "a" * 64
        payload_fingerprint = "b" * 64
        relative_path = "sermons/missing.mp3"
        with tempfile.TemporaryDirectory() as directory:
            disposition_path = Path(directory) / "reviewed.json"
            disposition_path.write_text(json.dumps({
                "version": 1,
                "snapshotSha256": snapshot_sha256,
                "reviewedBy": "Content owner",
                "reviewedAt": "2026-07-22T12:00:00Z",
                "finalPayloadFingerprint": payload_fingerprint,
                "dispositions": [{
                    "relativePath": relative_path,
                    "action": "remove-public-reference",
                    "reason": "The source recording is permanently unavailable.",
                    "referencedBy": ["wpfc_sermon:9"],
                }],
            }), encoding="utf-8")
            evidence, removals = MODULE.load_reviewed_media_dispositions(
                disposition_path, snapshot_sha256, False,
            )

        self.assertEqual(removals, {relative_path: ("wpfc_sermon:9",)})
        self.assertEqual(evidence["snapshotSha256"], snapshot_sha256)
        references = MODULE.defaultdict(set)
        references[relative_path].add("wpfc_sermon:9")
        missing_record = MODULE.MediaRecord(
            "9", "Missing", relative_path,
            f"https://www.pastorwood.org/wp-content/uploads/{relative_path}",
            "audio/mpeg", "public", ("wpfc_sermon:9",), False, None,
        )
        coverage = MODULE.build_media_reference_coverage(
            references, [missing_record], {}, removals,
            payload_fingerprint, payload_fingerprint, [], True,
        )
        MODULE.validate_media_reference_coverage(coverage)
        self.assertEqual(coverage["records"][0]["disposition"], "reviewed-reference-removal")
        records = [{
            "body": (
                f'<a href="/media/legacy/{relative_path}">Unavailable audio</a>'
                f'<a href=/media/legacy/{relative_path}>Unquoted audio</a>'
                f'<img src="/media/legacy/{relative_path}">'
                f'<audio src="/media/legacy/{relative_path}"></audio>'
                f' Plain /media/legacy/{relative_path} reference.'
            ),
        }]
        MODULE.apply_verified_media_replacements((records,), {}, set(removals))
        self.assertNotIn("/media/legacy/", records[0]["body"])
        self.assertNotRegex(records[0]["body"], r'(?:href|src|poster)\s*=\s*["\']\s*["\']')
        self.assertGreaterEqual(records[0]["body"].count("Media unavailable."), 5)

        collision = [{
            "body": (
                f'<a href="/media/legacy/{relative_path}">Remove</a>'
                f'<a href="/media/legacy/{relative_path}.backup">Keep</a>'
            ),
        }]
        MODULE.apply_verified_media_replacements((collision,), {}, set(removals))
        self.assertNotIn(f'/media/legacy/{relative_path}"', collision[0]["body"])
        self.assertIn(f'/media/legacy/{relative_path}.backup', collision[0]["body"])

        responsive = [{
            "body": (
                '<img src="/media/legacy/sermons/verified.jpg" '
                f'srcset="/media/legacy/{relative_path} 300w, '
                '/media/legacy/sermons/verified.jpg 600w">'
            ),
        }]
        MODULE.apply_verified_media_replacements((responsive,), {}, set(removals))
        self.assertNotIn("srcset=", responsive[0]["body"])
        self.assertNotIn("Media unavailable. 300w", responsive[0]["body"])
        self.assertIn('src="/media/legacy/sermons/verified.jpg"', responsive[0]["body"])

        drifted = MODULE.build_media_reference_coverage(
            references, [missing_record], {}, removals,
            payload_fingerprint, "c" * 64, [], True,
        )
        with self.assertRaisesRegex(RuntimeError, "coverage is incomplete"):
            MODULE.validate_media_reference_coverage(drifted)

    def test_phase_two_rehashes_exact_phase_one_media_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            public_root = Path(directory) / "public"
            public_file = public_root / "2024" / "episode.mp3"
            public_file.parent.mkdir(parents=True)
            payload = b"phase-one immutable public media"
            public_file.write_bytes(payload)
            digest = hashlib.sha256(payload).hexdigest()
            record = MODULE.MediaRecord(
                "1", "Episode", "2024/episode.mp3",
                "https://www.pastorwood.org/wp-content/uploads/2024/episode.mp3",
                "audio/mpeg", "public", ("wpfc_sermon:1",), True, len(payload),
            )
            mutations = {"media:1": {
                "kind": "media",
                "identity": "1",
                "publicMediaEvidence": {
                    "relativePath": record.relative_path,
                    "publicPath": "/media/legacy/2024/episode.mp3",
                    "sha256": digest,
                    "sizeBytes": len(payload),
                },
            }}

            verified = MODULE.verify_phase1_public_media_evidence([record], mutations, public_root)
            self.assertEqual(verified["verifiedFiles"], 1)
            self.assertRegex(verified["evidenceFingerprint"], r"^[a-f0-9]{64}$")

            public_file.write_bytes(b"tampered phase-two media payload")
            with self.assertRaisesRegex(RuntimeError, "drifted"):
                MODULE.verify_phase1_public_media_evidence([record], mutations, public_root)

    def test_phase_two_rejects_missing_extra_and_symlink_media_evidence(self):
        payload = b"public media"
        record = MODULE.MediaRecord(
            "1", "Episode", "episode.mp3",
            "https://www.pastorwood.org/wp-content/uploads/episode.mp3",
            "audio/mpeg", "public", ("wpfc_sermon:1",), True, len(payload),
        )
        with tempfile.TemporaryDirectory() as directory:
            public_root = Path(directory) / "public"
            public_root.mkdir()
            with self.assertRaisesRegex(RuntimeError, "not exact"):
                MODULE.verify_phase1_public_media_evidence([record], {}, public_root)

            target = Path(directory) / "target.mp3"
            target.write_bytes(payload)
            (public_root / "episode.mp3").symlink_to(target)
            digest = hashlib.sha256(payload).hexdigest()
            mutations = {"media:1": {
                "kind": "media", "identity": "1",
                "publicMediaEvidence": {
                    "relativePath": "episode.mp3",
                    "publicPath": "/media/legacy/episode.mp3",
                    "sha256": digest,
                    "sizeBytes": len(payload),
                },
            }}
            with self.assertRaisesRegex(RuntimeError, "symlink"):
                MODULE.verify_phase1_public_media_evidence([record], mutations, public_root)

            mutations["media:extra"] = {
                "kind": "media", "identity": "extra", "publicMediaEvidence": {},
            }
            with self.assertRaisesRegex(RuntimeError, "not exact"):
                MODULE.verify_phase1_public_media_evidence([record], mutations, public_root)

    def test_public_media_requires_manifest_and_published_reference(self):
        attachments = [{"id": "5", "title": "Show", "mimeType": "audio/mpeg", "meta": {"_wp_attached_file": "sermons/show.mp3"}}]
        manifest = ["https://www.pastorwood.org/wp-content/uploads/sermons/show.mp3"]
        references = MODULE.defaultdict(set)
        references["sermons/show.mp3"].add("wpfc_sermon:4")
        with tempfile.TemporaryDirectory() as directory:
            records, rejected = MODULE.build_media_records(attachments, manifest, [], references, Path(directory), False)

        self.assertEqual(rejected, [])
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].visibility, "public")

    def test_unreferenced_manifest_media_defaults_private(self):
        manifest = ["https://www.pastorwood.org/wp-content/uploads/2020/orphan.jpg"]
        with tempfile.TemporaryDirectory() as directory:
            records, _ = MODULE.build_media_records([], manifest, [], MODULE.defaultdict(set), Path(directory), False)
        self.assertEqual(records[0].visibility, "private")

    def test_legacy_url_cleanup_and_redirect_target_guards(self):
        path, source = MODULE.normalize_legacy_url('https://www.pastorwood.org/wp-sitemap.xsl" ?>')
        self.assertEqual(path, "/wp-sitemap.xsl")
        self.assertTrue(source.startswith("https://www.pastorwood.org/"))
        self.assertEqual(MODULE.safe_redirect_target("/old/", "/radio/new/"), "/radio/new/")
        for target in ["https://evil.example/", "//evil.example/", "/admin/users/"]:
            with self.subTest(target=target):
                with self.assertRaises(ValueError):
                    MODULE.safe_redirect_target("/old/", target)

    def test_redirect_plan_keeps_one_record_per_legacy_path(self):
        legacy = [
            "https://www.pastorwood.org/2024/01/hello/",
            "https://www.pastorwood.org/radio/show/",
            "https://www.pastorwood.org/about-pastor-wood/",
        ]
        posts = [{"slug": "hello"}]
        episodes = [{"slug": "show-current", "wpSermonId": "9"}]
        wordpress = [{"id": "9", "type": "wpfc_sermon", "slug": "show"}]

        redirects, failures, unmatched = MODULE.build_redirects(legacy, wordpress, posts, episodes, [])

        self.assertEqual(failures, [])
        self.assertEqual(len(unmatched), 1)
        self.assertEqual(unmatched[0]["reason"], "already-canonical-self")
        self.assertEqual(len(redirects), 2)
        by_path = {row["fromPath"]: row["toPath"] for row in redirects}
        self.assertEqual(by_path["/2024/01/hello/"], "/writings/hello/")
        self.assertEqual(by_path["/radio/show/"], "/radio/show-current/")

    def test_unknown_and_private_attachment_paths_are_not_soft_404_redirects(self):
        legacy = [
            "https://www.pastorwood.org/not-a-real-page/",
            "https://www.pastorwood.org/wp-content/uploads/private/member.pdf",
        ]

        redirects, failures, unmatched = MODULE.build_redirects(legacy, [], [], [], [])

        self.assertEqual(redirects, [])
        self.assertEqual(failures, [])
        self.assertEqual({item["reason"] for item in unmatched}, {"no-equivalent-public-target", "private-or-unpublished-attachment"})

    def test_imported_dynamic_page_is_accounted_for_as_an_existing_canonical_route(self):
        legacy = ["https://www.pastorwood.org/1172-2/"]
        wordpress = [{
            "id": "1172", "type": "page", "slug": "1172-2", "title": "1172 2",
            "content": "A published legacy page retained through the dynamic CMS route.", "excerpt": "",
        }]

        redirects, failures, unmatched = MODULE.build_redirects(legacy, wordpress, [], [], [])

        self.assertEqual(redirects, [])
        self.assertEqual(failures, [])
        self.assertEqual(unmatched[0]["reason"], "already-canonical-self")

    def test_unmatched_radio_item_does_not_fall_back_to_archive(self):
        redirects, failures, unmatched = MODULE.build_redirects(
            ["https://www.pastorwood.org/radio/missing-episode/"], [], [], [], [],
        )
        self.assertEqual(redirects, [])
        self.assertEqual(failures, [])
        self.assertEqual(unmatched[0]["reason"], "unmatched-radio-item")

    def test_legacy_resources_category_maps_to_the_public_resources_index(self):
        target, reason = MODULE.redirect_target_for("/category/resources/", {}, {}, set())
        self.assertEqual(target, "/written-resources/")
        self.assertEqual(reason, "taxonomy-fallback")

    def test_legacy_website_privacy_never_claims_the_sermon_search_gpt_policy_route(self):
        target, reason = MODULE.redirect_target_for("/privacy/", {}, {}, set())
        pages, excluded = MODULE.build_pages([{
            "id": "81", "type": "page", "slug": "privacy", "title": "Website Privacy",
            "content": "<p>Website privacy terms.</p>", "excerpt": "", "meta": {},
        }])

        self.assertEqual((target, reason), (None, "owned-current-sermon-search-gpt-route"))
        self.assertEqual(
            MODULE.redirect_target_for("/privacy/archive/", {}, {}, set()),
            (None, "owned-current-sermon-search-gpt-route"),
        )
        self.assertEqual(excluded, [])
        self.assertEqual(pages[0]["pageKey"], "privacy-terms-conditions")
        self.assertEqual(pages[0]["slug"], "privacy-terms-conditions")
        redirects, failures, unmatched = MODULE.build_redirects(
            ["https://www.pastorwood.org/privacy/"],
            [{
                "id": "81", "type": "page", "slug": "privacy", "title": "Website Privacy",
                "content": "<p>Website privacy terms.</p>", "excerpt": "", "meta": {},
            }],
            [], [], [],
        )
        self.assertEqual(redirects, [])
        self.assertEqual(failures, [])
        self.assertEqual(unmatched[0]["reason"], "owned-current-sermon-search-gpt-route")

    def test_missing_public_media_never_receives_redirect(self):
        record = MODULE.MediaRecord("1", "Missing", "2024/missing.mp3", "https://www.pastorwood.org/wp-content/uploads/2024/missing.mp3", "audio/mpeg", "public", ("legacy-public-sitemap",), False, None)
        redirects, failures, unmatched = MODULE.build_redirects(
            [record.source_url], [], [], [], [record],
        )
        self.assertEqual(redirects, [])
        self.assertEqual(failures, [])
        self.assertEqual(unmatched[0]["reason"], "private-or-unpublished-attachment")

    def test_reserved_current_routes_cannot_be_legacy_redirect_sources(self):
        legacy = [
            "https://www.pastorwood.org/admin/",
            "https://www.pastorwood.org/api/private/",
            "https://www.pastorwood.org/content/pages/",
        ]

        redirects, failures, unmatched = MODULE.build_redirects(legacy, [], [], [], [])

        self.assertEqual(redirects, [])
        self.assertEqual(unmatched, [])
        self.assertEqual(len(failures), 3)
        self.assertTrue(all("reserved route" in item["reason"] for item in failures))


if __name__ == "__main__":
    unittest.main()
