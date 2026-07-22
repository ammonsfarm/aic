import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const clientQuery = vi.fn();
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query: clientQuery, release }));
  return { clientQuery, release, connect, queryRows: vi.fn(), getPool: vi.fn(() => ({ connect })) };
});

vi.mock("@/lib/db", () => ({ queryRows: mocks.queryRows, getPool: mocks.getPool }));

import { listMatchedPodtracEpisodes, queuePipelineRetry, reconcilePodtracEpisode } from "@/lib/admin-operations";

describe("admin operation database workflows", () => {
  beforeEach(() => {
    mocks.clientQuery.mockReset();
    mocks.queryRows.mockReset();
    mocks.release.mockReset();
    mocks.connect.mockClear();
  });

  it("queues an allowlisted retry and audit row in one transaction", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("returning id::text, stage")) {
        return {
          rows: [{
            id: "42",
            stage: "daily-ingest",
            source_run_id: "run-1",
            reason: "recover a failed stage",
            status: "queued",
            requested_by: "admin@example.test",
            requested_at: "2026-07-22T12:00:00Z",
            started_at: null,
            completed_at: null,
            output_summary: "",
            error: "",
          }],
        };
      }
      return { rows: [] };
    });

    const result = await queuePipelineRetry({
      stage: "daily-ingest",
      sourceRunId: "run-1",
      reason: "recover a failed stage",
      actorEmail: "admin@example.test",
    });
    expect(result.id).toBe("42");
    expect(mocks.clientQuery.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/).slice(0, 3).join(" ")))
      .toEqual(expect.arrayContaining(["begin", "insert into pipeline_retry_requests(stage,", "insert into admin_operation_audit(action,", "commit"]));
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("audits and resets terminal transcript work when an administrator retries that stage", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("with candidates as") && sql.includes("revectorization_terminal")) {
        return { rows: [{ edit_count: 2, revectorization_count: 1 }] };
      }
      if (sql.includes("returning id::text, stage")) {
        return {
          rows: [{
            id: "43",
            stage: "transcript-edits",
            source_run_id: null,
            reason: "credentials repaired",
            status: "queued",
            requested_by: "admin@example.test",
            requested_at: "2026-07-22T12:00:00Z",
            started_at: null,
            completed_at: null,
            output_summary: "",
            error: "",
          }],
        };
      }
      return { rows: [] };
    });

    await queuePipelineRetry({
      stage: "transcript-edits",
      reason: "credentials repaired",
      actorEmail: "admin@example.test",
    });

    const statements = mocks.clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("next_revectorization_at = case"))).toBe(true);
    expect(statements.some((sql) => sql.includes("transcript_terminal_retry_reset"))).toBe(true);
    expect(statements.at(-1)).toBe("commit");
  });

  it("reconciles a Podtrac row and writes immutable audit records", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("from podtrac_episodes") && sql.includes("for update")) {
        return { rows: [{ podtrac_episode_id: "p1", track_id: null, match_status: "unmatched" }] };
      }
      if (sql.includes("select track_id from episodes")) return { rows: [{ track_id: "t1" }] };
      if (sql.includes("returning id::text")) return { rows: [{ id: "7" }] };
      return { rows: [] };
    });

    const result = await reconcilePodtracEpisode({
      podtracEpisodeId: "p1",
      trackId: "t1",
      note: "verified title and date",
      actorEmail: "admin@example.test",
    });
    expect(result).toMatchObject({ auditId: "7", action: "match", podtracEpisodeId: "p1", trackId: "t1" });
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes("update podtrac_episodes"))).toBe(true);
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes("insert into podtrac_reconciliation_audit"))).toBe(true);
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes("insert into admin_operation_audit"))).toBe(true);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("lists current matches so an administrator can review and remove a bad assignment", async () => {
    mocks.queryRows.mockResolvedValueOnce([{
      podtrac_episode_id: "p1",
      title: "Podtrac title",
      publish_date: "2026-07-20",
      match_notes: "manual review",
      track_id: "t1",
      episode_title: "Archive title",
      episode_publish_date: "2026-07-19",
    }]);

    await expect(listMatchedPodtracEpisodes({ query: "Archive", limit: 20 })).resolves.toEqual([{
      podtracEpisodeId: "p1",
      title: "Podtrac title",
      publishDate: "2026-07-20",
      matchNotes: "manual review",
      trackId: "t1",
      episodeTitle: "Archive title",
      episodePublishDate: "2026-07-19",
    }]);
    const [sql, params] = mocks.queryRows.mock.calls[0];
    expect(String(sql)).toContain("pe.match_status = 'matched'");
    expect(String(sql)).toContain("pe.track_id is not null");
    expect(params).toEqual(["Archive", 20]);
  });

  it("removes a bad Podtrac match and records the unmatch in both audit trails", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("from podtrac_episodes") && sql.includes("for update")) {
        return { rows: [{ podtrac_episode_id: "p1", track_id: "wrong-track", match_status: "matched" }] };
      }
      if (sql.includes("returning id::text")) return { rows: [{ id: "8" }] };
      return { rows: [] };
    });

    const result = await reconcilePodtracEpisode({
      podtracEpisodeId: "p1",
      trackId: null,
      note: "incorrect archive episode",
      actorEmail: "admin@example.test",
    });

    expect(result).toMatchObject({ auditId: "8", action: "unmatch", podtracEpisodeId: "p1", trackId: null });
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes("select track_id from episodes"))).toBe(false);
    const updateCall = mocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes("update podtrac_episodes"));
    expect(updateCall?.[1]).toEqual(["p1", null, "incorrect archive episode"]);
    const reconciliationAudit = mocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes("insert into podtrac_reconciliation_audit"));
    expect(reconciliationAudit?.[1]).toEqual([
      "p1",
      "wrong-track",
      null,
      "matched",
      "unmatch",
      "incorrect archive episode",
      "admin@example.test",
    ]);
    expect(mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes("insert into admin_operation_audit"))).toBe(true);
  });

  it("rejects an unmatch without an audit note before opening a database transaction", async () => {
    await expect(reconcilePodtracEpisode({
      podtracEpisodeId: "p1",
      trackId: null,
      note: "",
      actorEmail: "admin@example.test",
    })).rejects.toThrow(/audit note is required/i);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
