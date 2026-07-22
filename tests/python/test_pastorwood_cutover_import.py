import importlib.util
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "pastorwood_cutover_import.py"
SPEC = importlib.util.spec_from_file_location("pastorwood_cutover_import", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class CutoverIdentityTests(unittest.TestCase):
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

    def test_radio_taxonomy_archive_never_maps_to_an_episode_detail(self):
        target, reason = MODULE.redirect_target_for(
            "/radio/topics/covenant-community-church-galatians-2/",
            {},
            {"covenant-community-church-galatians-2": "/radio/episode/"},
            set(),
        )
        self.assertIsNone(target)
        self.assertEqual(reason, "radio-taxonomy-archive")

    def test_media_path_rejects_traversal_and_private_operational_trees(self):
        bad_paths = [
            "../secret.txt",
            "/wp-content/uploads/gravity_forms/export.csv",
            "/wp-content/uploads/woocommerce_uploads/order.pdf",
            "/wp-content/uploads/logs/debug.log",
            "%2e%2e/private.txt",
        ]
        for value in bad_paths:
            with self.subTest(value=value):
                self.assertIsNone(MODULE.safe_upload_relative_path(value))

        self.assertEqual(
            MODULE.safe_upload_relative_path("https://www.pastorwood.org/wp-content/uploads/sermons/2024/01/show.mp3"),
            "sermons/2024/01/show.mp3",
        )

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

    def test_unmatched_radio_item_does_not_fall_back_to_archive(self):
        redirects, failures, unmatched = MODULE.build_redirects(
            ["https://www.pastorwood.org/radio/missing-episode/"], [], [], [], [],
        )
        self.assertEqual(redirects, [])
        self.assertEqual(failures, [])
        self.assertEqual(unmatched[0]["reason"], "unmatched-radio-item")

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
