#!/usr/bin/env python3
"""Explain one-to-one episode match changes between the DB and REST-merged source."""

from __future__ import annotations

import argparse
import json

import pastorwood_cutover_import as cutover


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    cutover_args = cutover.parse_args(["--wordpress-rest-snapshot", args.snapshot])
    database_content, database_media = cutover.fetch_wordpress(cutover_args)
    rest_content, rest_media, _evidence = cutover.load_wordpress_rest_snapshot(cutover_args.wordpress_rest_snapshot, None)
    merged_content, _merged_media, _report = cutover.merge_wordpress_sources(database_content, database_media, rest_content, rest_media)
    env = {key: value for key, value in __import__("os").environ.items() if value}
    aic_episodes, _posts = cutover.fetch_aic(env, cutover_args.aic_postgres_image)
    database_sermons = [row for row in database_content if cutover.text(row.get("type")) == "wpfc_sermon"]
    merged_sermons = [row for row in merged_content if cutover.text(row.get("type")) == "wpfc_sermon"]
    old_matches = cutover.match_episodes(aic_episodes, database_sermons)
    merged_matches = cutover.match_episodes(aic_episodes, merged_sermons)
    old_by_track = {match.aic_track_id: match for match in old_matches}
    merged_by_track = {match.aic_track_id: match for match in merged_matches}
    rest_only_ids = {
        cutover.text(row.get("id"))
        for row in rest_content
        if cutover.text(row.get("type")) == "wpfc_sermon"
        and cutover.text(row.get("id")) not in {cutover.text(item.get("id")) for item in database_sermons}
    }
    merged_by_id = {cutover.text(row.get("id")): row for row in merged_sermons}
    aic_by_track = {cutover.text(row.get("trackId")): row for row in aic_episodes}
    matched_rest_ids = {match.wp_sermon_id for match in merged_matches if match.wp_sermon_id in rest_only_ids}
    aic_candidates: dict[str, list[dict[str, str]]] = {}
    for wp_id in sorted(rest_only_ids - matched_rest_ids, key=int):
        sermon = merged_by_id[wp_id]
        title_key = cutover.canonical_episode_title(cutover.text(sermon.get("title")))
        date = cutover.wordpress_sermon_date(sermon)
        candidates = []
        for episode in aic_episodes:
            episode_title = cutover.canonical_episode_title(cutover.text(episode.get("title")))
            if episode_title == title_key or (date and cutover.iso_date(episode.get("publishDate")) == date):
                candidates.append({
                    "trackId": cutover.text(episode.get("trackId")),
                    "title": cutover.text(episode.get("title")),
                    "date": cutover.iso_date(episode.get("publishDate")),
                    "currentWpSermonId": merged_by_track.get(cutover.text(episode.get("trackId"))).wp_sermon_id if cutover.text(episode.get("trackId")) in merged_by_track else "",
                })
        aic_candidates[wp_id] = candidates
    result = {
        "oldMatchCount": len(old_matches),
        "mergedMatchCount": len(merged_matches),
        "restOnlyMatched": sorted(matched_rest_ids, key=int),
        "restOnlyUnmatched": [
            {
                "wpSermonId": wp_id,
                "title": cutover.text(merged_by_id[wp_id].get("title")),
                "date": cutover.wordpress_sermon_date(merged_by_id[wp_id]),
                "audio": cutover.sermon_audio_relative(merged_by_id[wp_id]) or "",
                "aicCandidates": aic_candidates[wp_id],
            }
            for wp_id in sorted(rest_only_ids - matched_rest_ids, key=int)
        ],
        "changedTrackAssignments": [
            {
                "trackId": track_id,
                "oldWpSermonId": old_by_track.get(track_id).wp_sermon_id if track_id in old_by_track else "",
                "newWpSermonId": merged_by_track.get(track_id).wp_sermon_id if track_id in merged_by_track else "",
                "newIsRestOnly": merged_by_track.get(track_id).wp_sermon_id in rest_only_ids if track_id in merged_by_track else False,
                "aicTitle": cutover.text(aic_by_track[track_id].get("title")),
                "aicDate": cutover.iso_date(aic_by_track[track_id].get("publishDate")),
                "newWpTitle": cutover.text(merged_by_id[merged_by_track[track_id].wp_sermon_id].get("title")) if track_id in merged_by_track else "",
                "newWpDate": cutover.wordpress_sermon_date(merged_by_id[merged_by_track[track_id].wp_sermon_id]) if track_id in merged_by_track else "",
                "newMatchMethod": merged_by_track[track_id].method if track_id in merged_by_track else "",
            }
            for track_id in sorted(set(old_by_track) | set(merged_by_track))
            if old_by_track.get(track_id) != merged_by_track.get(track_id)
        ],
    }
    cutover.write_json(__import__("pathlib").Path(args.output), result)
    print(json.dumps({"output": args.output, "changed": len(result["changedTrackAssignments"]), "restUnmatched": len(result["restOnlyUnmatched"])}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
