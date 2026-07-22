import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRows: vi.fn() }));

vi.mock("@/lib/db", () => ({ queryRows: mocks.queryRows }));

import { buildPodcastCsvReport } from "@/lib/podcast-export";

describe("podcast operational exports", () => {
  beforeEach(() => {
    mocks.queryRows.mockReset();
  });

  it("exports ingest runs, stage events, Podtrac syncs, and retry requests as one pipeline timeline", async () => {
    mocks.queryRows.mockResolvedValueOnce([{
      event_source: "pipeline_retry",
      event_id: "9",
      run_id: "run-1",
      stage: "podtrac-import",
      status: "failed",
      requested_by: "admin@example.test",
      started_at: "2026-07-22T12:00:00Z",
      completed_at: "2026-07-22T12:01:00Z",
      error: "authentication failed",
      detail: "retry after credentials refresh",
    }]);

    const csv = await buildPodcastCsvReport({
      report: "pipeline",
      startDate: "2026-07-01",
      endDate: "2026-07-22",
    });

    const [sql, params] = mocks.queryRows.mock.calls[0];
    for (const table of ["ingest_runs", "ingest_stage_events", "podtrac_sync_runs", "pipeline_retry_requests"]) {
      expect(String(sql)).toContain(`from ${table}`);
    }
    expect(params).toEqual(["2026-07-01", "2026-07-22"]);
    expect(csv).toContain("event_source,event_id,run_id,stage,status,requested_by,started_at,completed_at,error,detail");
    expect(csv).toContain("pipeline_retry,9,run-1,podtrac-import,failed,admin@example.test");
  });
});
