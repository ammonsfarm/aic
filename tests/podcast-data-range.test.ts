import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRows } = vi.hoisted(() => ({ queryRows: vi.fn() }));
vi.mock("@/lib/db", () => ({ queryRows }));

import { getPodcastStatsDashboard } from "@/lib/podcast-data";

describe("podcast dashboard query ranges", () => {
  beforeEach(() => queryRows.mockReset());

  it("applies selected dates to totals, trend, top episodes and countries", async () => {
    queryRows.mockImplementation((sql: string) => {
      const statement = String(sql ?? "");
      if (statement.includes("min(activity_date)")) return Promise.resolve([{ min_date: "2025-01-01", max_date: "2026-07-13" }]);
      if (statement.includes("previous_range_downloads")) {
        return Promise.resolve([{
          range_downloads: "100",
          previous_range_downloads: "80",
          all_time_downloads: "1000",
          podtrac_episode_count: "4",
          podtrac_matched_count: "3",
          podtrac_unmatched_count: "1",
        }]);
      }
      return Promise.resolve([]);
    });

    const dashboard = await getPodcastStatsDashboard("30d", { today: "2026-07-22" });
    expect(dashboard.range).toMatchObject({ startDate: "2026-06-23", endDate: "2026-07-22" });
    expect(dashboard.comparison.changePercent).toBe(25);
    const topEpisodeCall = queryRows.mock.calls.find(([sql]) => String(sql).includes("with podtrac_by_track"));
    expect(topEpisodeCall?.[0]).toContain("pda.activity_date between $1::date and $2::date");
    expect(topEpisodeCall?.[1]).toEqual(["2026-06-23", "2026-07-22"]);
    const rangedCalls = queryRows.mock.calls.filter(([, values]) => Array.isArray(values) && values[0] === "2026-06-23");
    expect(rangedCalls.length).toBeGreaterThanOrEqual(4);
  });
});
