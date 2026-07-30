import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRows } = vi.hoisted(() => ({ queryRows: vi.fn() }));
vi.mock("@/lib/db", () => ({ queryRows }));

import { getEpisodeStatisticsDashboard, getPodcastStatsDashboard } from "@/lib/podcast-data";

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
      if (statement.includes("with days as")) {
        return Promise.resolve([
          { activity_date: "2026-07-12", downloads: "0" },
          { activity_date: "2026-07-13", downloads: "9" },
          { activity_date: "2026-07-14", downloads: null },
          { activity_date: "2026-07-22", downloads: "0" },
        ]);
      }
      return Promise.resolve([]);
    });

    const dashboard = await getPodcastStatsDashboard("30d", { today: "2026-07-22" });
    expect(dashboard.range).toMatchObject({ startDate: "2026-06-23", endDate: "2026-07-22" });
    expect(dashboard.coverage).toMatchObject({
      loadedStartDate: "2026-06-23",
      loadedEndDate: "2026-07-13",
      unavailableStartDate: "2026-07-14",
      unavailableEndDate: "2026-07-22",
    });
    expect(dashboard.comparison.changePercent).toBe(25);
    expect(dashboard.dailyTrend).toEqual([
      { activityDate: "2026-07-12", downloads: 0 },
      { activityDate: "2026-07-13", downloads: 9 },
      { activityDate: "2026-07-14", downloads: null },
      { activityDate: "2026-07-22", downloads: null },
    ]);
    const summaryCall = queryRows.mock.calls.find(([sql]) => String(sql).includes("previous_range_downloads"));
    expect(summaryCall?.[1]).toEqual(["2026-06-23", "2026-07-13", "2026-06-02", "2026-06-22"]);
    const topEpisodeCall = queryRows.mock.calls.find(([sql]) => String(sql).includes("with podtrac_by_track"));
    expect(topEpisodeCall?.[0]).toContain("pda.activity_date between $1::date and $2::date");
    expect(topEpisodeCall?.[1]).toEqual(["2026-06-23", "2026-07-13"]);
    const trendCall = queryRows.mock.calls.find(([sql]) => String(sql).includes("with days as"));
    expect(trendCall?.[0]).toContain("when days.activity_date > $3::date then null");
    expect(trendCall?.[1]).toEqual(["2026-06-23", "2026-07-22", "2026-07-13"]);
    const rangedCalls = queryRows.mock.calls.filter(([, values]) => Array.isArray(values) && values[0] === "2026-06-23");
    expect(rangedCalls.length).toBeGreaterThanOrEqual(4);
  });

  it("does not query reversed ranges or invent a zero total when the selected window is not loaded", async () => {
    queryRows.mockImplementation((sql: string) => {
      const statement = String(sql ?? "");
      if (statement.includes("min(activity_date)")) {
        return Promise.resolve([{ min_date: "2025-01-01", max_date: "2026-07-13" }]);
      }
      if (statement.includes("previous_range_downloads")) {
        return Promise.resolve([{
          range_downloads: "0",
          previous_range_downloads: "0",
          all_time_downloads: "1000",
          podtrac_episode_count: "4",
          podtrac_matched_count: "3",
          podtrac_unmatched_count: "1",
        }]);
      }
      if (statement.includes("with days as")) {
        return Promise.resolve([
          { activity_date: "2026-07-14", downloads: null },
          { activity_date: "2026-07-22", downloads: null },
        ]);
      }
      return Promise.resolve([]);
    });

    const dashboard = await getPodcastStatsDashboard("custom", {
      startDate: "2026-07-14",
      endDate: "2026-07-22",
      today: "2026-07-22",
    });

    expect(dashboard.coverage.loadedDays).toBe(0);
    expect(dashboard.counts.rangeDownloads).toBeNull();
    expect(dashboard.comparison.previousDownloads).toBeNull();
    expect(dashboard.topEpisodes).toEqual([]);
    expect(dashboard.countryDownloads).toEqual([]);
    const summaryCall = queryRows.mock.calls.find(([sql]) => String(sql).includes("previous_range_downloads"));
    expect(summaryCall?.[1]).toEqual(["2026-07-14", "2026-07-14", "2026-07-14", "2026-07-14"]);
  });

  it("caps episode summaries, lists, and breakdowns while marking both trends after current-through unavailable", async () => {
    queryRows.mockImplementation((sql: string) => {
      const statement = String(sql ?? "");
      if (statement.includes("min(activity_date)")) {
        return Promise.resolve([{ min_date: "2025-01-01", max_date: "2026-07-13" }]);
      }
      if (statement.includes("count(distinct pe.track_id)::text as count")) {
        return Promise.resolve([{ count: "1" }]);
      }
      if (statement.includes("matched_episodes")) {
        return Promise.resolve([{
          all_time_downloads: "1000",
          range_downloads: "100",
          previous_range_downloads: "80",
          first_activity_date: "2025-01-01",
          last_activity_date: "2026-07-13",
          matched_episodes: "1",
        }]);
      }
      if (statement.includes("with days as") && statement.includes("pe.track_id = $1")) {
        return Promise.resolve([
          { activity_date: "2026-07-13", downloads: "4" },
          { activity_date: "2026-07-14", downloads: null },
          { activity_date: "2026-07-22", downloads: "0" },
        ]);
      }
      if (statement.includes("with days as")) {
        return Promise.resolve([
          { activity_date: "2026-07-12", downloads: "0" },
          { activity_date: "2026-07-13", downloads: "9" },
          { activity_date: "2026-07-14", downloads: null },
          { activity_date: "2026-07-22", downloads: "0" },
        ]);
      }
      if (statement.includes("with podtrac_by_track")) {
        return Promise.resolve([{
          track_id: "track-1",
          title: "Loaded episode",
          publish_date: "2026-01-01",
          podtrac_title: "Loaded episode",
          match_status: "matched",
          all_time_downloads: "1000",
          range_downloads: "100",
          last_activity_date: "2026-07-13",
        }]);
      }
      if (statement.includes("from podtrac_activity_by_country")) {
        return Promise.resolve([{ name: "United States", downloads: "70" }]);
      }
      if (statement.includes("from podtrac_activity_by_client")) {
        return Promise.resolve([{ name: "Browser", downloads: "60" }]);
      }
      if (statement.includes("where pe.track_id = $1")) {
        return Promise.resolve([{
          all_time_downloads: "1000",
          range_downloads: "100",
          first_activity_date: "2025-01-01",
          last_activity_date: "2026-07-13",
        }]);
      }
      if (statement.includes("where e.track_id = $1")) {
        return Promise.resolve([{
          track_id: "track-1",
          title: "Loaded episode",
          publish_date: "2026-01-01",
          podtrac_title: "Loaded episode",
          match_status: "matched",
          all_time_downloads: "1000",
          range_downloads: "100",
          last_activity_date: "2026-07-13",
        }]);
      }
      return Promise.resolve([]);
    });

    const dashboard = await getEpisodeStatisticsDashboard({
      rangeKey: "30d",
      trackId: "track-1",
      downloadDate: "2026-07-14",
      today: "2026-07-22",
    });

    expect(dashboard.selectedDownloadDate).toBeNull();
    expect(dashboard.dailyTrend).toEqual([
      { activityDate: "2026-07-12", downloads: 0 },
      { activityDate: "2026-07-13", downloads: 9 },
      { activityDate: "2026-07-14", downloads: null },
      { activityDate: "2026-07-22", downloads: null },
    ]);
    expect(dashboard.selectedDailyTrend).toEqual([
      { activityDate: "2026-07-13", downloads: 4 },
      { activityDate: "2026-07-14", downloads: null },
      { activityDate: "2026-07-22", downloads: null },
    ]);

    const calls = queryRows.mock.calls.map(([sql, values]) => [String(sql), values] as const);
    expect(calls.find(([sql]) => sql.includes("matched_episodes"))?.[1])
      .toEqual(["2026-06-23", "2026-07-13", "2026-06-02", "2026-06-22"]);
    expect(calls.find(([sql]) => sql.includes("with podtrac_by_track"))?.[1])
      .toEqual(["2026-06-23", "2026-07-13", "", 50, 0]);
    expect(calls.find(([sql]) => sql.includes("from podtrac_activity_by_country"))?.[1])
      .toEqual(["2026-06-23", "2026-07-13", 10]);
    expect(calls.find(([sql]) => sql.includes("from podtrac_activity_by_client"))?.[1])
      .toEqual(["2026-06-23", "2026-07-13", 10]);
    expect(calls.find(([sql]) => sql.includes("with days as") && sql.includes("pe.track_id = $1"))?.[1])
      .toEqual(["track-1", "2026-06-23", "2026-07-22", "2026-07-13"]);
    expect(calls.some(([sql]) => sql.includes("where pda.activity_date = $1::date"))).toBe(false);
  });

  it("surfaces null episode totals when the selected episode range is wholly unavailable", async () => {
    queryRows.mockImplementation((sql: string) => {
      const statement = String(sql ?? "");
      if (statement.includes("min(activity_date)")) {
        return Promise.resolve([{ min_date: "2025-01-01", max_date: "2026-07-13" }]);
      }
      if (statement.includes("count(distinct pe.track_id)::text as count")) {
        return Promise.resolve([{ count: "1" }]);
      }
      if (statement.includes("matched_episodes")) {
        return Promise.resolve([{
          all_time_downloads: "1000",
          range_downloads: "0",
          previous_range_downloads: "0",
          first_activity_date: "2025-01-01",
          last_activity_date: "2026-07-13",
          matched_episodes: "1",
        }]);
      }
      if (statement.includes("with days as")) {
        return Promise.resolve([
          { activity_date: "2026-07-14", downloads: null },
          { activity_date: "2026-07-22", downloads: null },
        ]);
      }
      if (statement.includes("with podtrac_by_track")) {
        return Promise.resolve([{
          track_id: "track-1",
          title: "Existing episode",
          publish_date: "2026-01-01",
          podtrac_title: "Existing episode",
          match_status: "matched",
          all_time_downloads: "1000",
          range_downloads: "0",
          last_activity_date: "2026-07-13",
        }]);
      }
      return Promise.resolve([]);
    });

    const dashboard = await getEpisodeStatisticsDashboard({
      rangeKey: "custom",
      startDate: "2026-07-14",
      endDate: "2026-07-22",
      today: "2026-07-22",
    });

    expect(dashboard.coverage.loadedDays).toBe(0);
    expect(dashboard.summary.rangeDownloads).toBeNull();
    expect(dashboard.comparison.previousDownloads).toBeNull();
    expect(dashboard.episodes[0]?.rangeDownloads).toBeNull();
    expect(dashboard.dailyTrend.every((row) => row.downloads === null)).toBe(true);
    expect(dashboard.countryDownloads).toEqual([]);
    expect(dashboard.clientDownloads).toEqual([]);
    const summaryCall = queryRows.mock.calls.find(([sql]) => String(sql).includes("matched_episodes"));
    expect(summaryCall?.[1]).toEqual(["2026-07-14", "2026-07-14", "2026-07-14", "2026-07-14"]);
  });
});
