import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const clientQuery = vi.fn();
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query: clientQuery, release }));
  return { clientQuery, release, connect, queryRows: vi.fn(), getPool: vi.fn(() => ({ connect })) };
});

vi.mock("@/lib/db", () => ({ queryRows: mocks.queryRows, getPool: mocks.getPool }));

import {
  getOperationalDashboard,
  listMatchedPodtracEpisodes,
  listUnmatchedPodtracEpisodes,
  queuePipelineRetry,
  reconcilePodtracEpisode,
} from "@/lib/admin-operations";

describe("admin operation database workflows", () => {
  beforeEach(() => {
    mocks.clientQuery.mockReset();
    mocks.queryRows.mockReset();
    mocks.release.mockReset();
    mocks.connect.mockClear();
  });

  it("distinguishes a successful ingest check from Podtrac source-data currency", async () => {
    mocks.queryRows.mockImplementation(async (sql: string) => {
      if (sql.includes("as podtrac_current_through")) {
        return [{
          podtrac_current_through: "2026-07-20",
          ingest_last_successful_check_date: "2026-07-22",
        }];
      }
      if (sql.includes("from ingest_runs") && sql.includes("order by coalesce")) {
        return [{
          run_id: "ingest-1",
          status: "completed",
          stage: "complete",
          started_at: "2026-07-22T08:00:00Z",
          completed_at: "2026-07-22T08:15:00Z",
          error: "",
        }];
      }
      return [];
    });

    const dashboard = await getOperationalDashboard();
    expect(dashboard.freshness.ingest.lastSuccessfulCheckDate).toBe("2026-07-22");
    expect(dashboard.freshness.ingest).not.toHaveProperty("dataCurrentThrough");
    expect(dashboard.freshness.podtrac.dataCurrentThrough).toBe("2026-07-20");
    expect(dashboard.runs.find((run) => run.source === "daily-ingest")).not.toHaveProperty("dataCurrentThrough");

    const [extentSql] = mocks.queryRows.mock.calls.find(([sql]) => String(sql).includes("as podtrac_current_through"))!;
    expect(String(extentSql)).toContain("max(activity_date)");
    expect(String(extentSql)).toContain("max(completed_at)");
    expect(String(extentSql)).toContain("where status = 'completed'");
    expect(String(extentSql)).toContain("as ingest_last_successful_check_date");
  });

  it("keeps a recent failed auth attempt ahead of historical completed imports without borrowing coverage", async () => {
    mocks.queryRows.mockImplementation(async (sql: string) => {
      if (sql.includes("from podtrac_sync_runs psr")) {
        return [
          {
            id: "72",
            status: "failed",
            started_at: "2026-07-29T08:15:00Z",
            completed_at: "2026-07-29T08:15:05Z",
            error: "Podtrac authentication failed with HTTP 401.",
            import_run_id: null,
            import_started_at: null,
            imported_through: null,
          },
          {
            id: "60",
            status: "completed",
            started_at: "2026-07-13T08:15:00Z",
            completed_at: "2026-07-13T08:16:00Z",
            error: "",
            import_run_id: "123",
            import_started_at: "2026-07-13T08:15:30Z",
            imported_through: "2026-07-13",
          },
        ];
      }
      if (sql.includes("as podtrac_current_through")) {
        return [{
          podtrac_current_through: "2026-07-13",
          ingest_last_successful_check_date: "2026-07-29",
        }];
      }
      return [];
    });

    const dashboard = await getOperationalDashboard();
    expect(dashboard.podtracAuth.state).toBe("auth-error");
    expect(dashboard.freshness.podtrac.dataCurrentThrough).toBe("2026-07-13");
    expect(dashboard.runs.filter((run) => run.source === "podtrac-import")).toEqual([
      expect.objectContaining({ id: "72", status: "failed", dataCurrentThrough: null }),
      expect.objectContaining({ id: "123", status: "completed", dataCurrentThrough: "2026-07-13" }),
    ]);

    const [podtracSql] = mocks.queryRows.mock.calls.find(([sql]) => String(sql).includes("from podtrac_sync_runs psr"))!;
    expect(String(podtracSql)).toContain("exact_pir.run_id = psr.import_run_id");
    expect(String(podtracSql)).toMatch(/left join podtrac_import_runs exact_pir\s+on psr\.status = 'completed'\s+and exact_pir\.run_id = psr\.import_run_id/);
    expect(String(podtracSql)).toContain("psr.status = 'completed'");
    expect(String(podtracSql)).toContain("coalesce(psr.source_sqlite_path, '') not like 'direct-podtrac-api:%'");
    expect(String(podtracSql)).toContain("order by psr.started_at desc, psr.id desc");
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

  it("rejects every pipeline retry without an audit reason before opening a transaction", async () => {
    await expect(queuePipelineRetry({
      stage: "daily-ingest",
      sourceRunId: "run-1",
      reason: "   ",
      actorEmail: "admin@example.test",
    })).rejects.toThrow(/audit reason is required/i);
    expect(mocks.connect).not.toHaveBeenCalled();
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
      action: "match",
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
    expect(String(sql)).toContain("coalesce(e.publish_date::text, nullif(pe.matched_episode_publish_date, ''), '')");
    expect(params).toEqual(["Archive", 20]);
  });

  it("normalizes archive publish dates before unmatched candidate text checks", async () => {
    mocks.queryRows.mockResolvedValueOnce([]);

    await expect(listUnmatchedPodtracEpisodes({ limit: 20 })).resolves.toEqual([]);
    const [sql] = mocks.queryRows.mock.calls[0];
    expect(String(sql)).toContain("e.publish_date::text as publish_date");
    expect(String(sql)).toContain("e.publish_date::text ~");
    expect(String(sql)).not.toContain("and e.publish_date ~");
    expect(String(sql)).not.toContain("when e.publish_date ~");
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
      action: "unmatch",
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

  it.each([
    { action: "match" as const, trackId: "t1" },
    { action: "unmatch" as const, trackId: null },
  ])("rejects a $action without an audit note before opening a transaction", async ({ action, trackId }) => {
    await expect(reconcilePodtracEpisode({
      action,
      podtracEpisodeId: "p1",
      trackId,
      note: "   ",
      actorEmail: "admin@example.test",
    })).rejects.toThrow(/audit note is required/i);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("rejects a manual match without a candidate before opening a database transaction", async () => {
    await expect(reconcilePodtracEpisode({
      action: "match",
      podtracEpisodeId: "p1",
      trackId: null,
      note: "title and date verified",
      actorEmail: "admin@example.test",
    })).rejects.toThrow(/candidate is required/i);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
