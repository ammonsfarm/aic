import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const clientQuery = vi.fn();
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query: clientQuery, release }));
  return { clientQuery, release, connect, queryRows: vi.fn(), getPool: vi.fn(() => ({ connect })) };
});

vi.mock("@/lib/db", () => ({ queryRows: mocks.queryRows, getPool: mocks.getPool }));

import { queuePipelineRetry, reconcilePodtracEpisode } from "@/lib/admin-operations";

describe("admin operation database workflows", () => {
  beforeEach(() => {
    mocks.clientQuery.mockReset();
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
});
