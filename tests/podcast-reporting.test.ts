import { describe, expect, it } from "vitest";

import {
  calculateFreshness,
  parsePodcastRange,
  percentageChange,
  previousReportCoverageRange,
  previousReportRange,
  reportCoverage,
  resolveReportDateRange,
  rowsToCsv,
} from "@/lib/podcast-reporting";
import { normalizeExportRange, parsePodcastExportReport } from "@/lib/podcast-export";

describe("podcast report ranges", () => {
  it("anchors rolling presets to today rather than the last imported row", () => {
    const range = resolveReportDateRange({
      key: "30d",
      minDate: "2025-01-01",
      maxDate: "2026-07-13",
      today: "2026-07-22",
    });
    expect(range.startDate).toBe("2026-06-23");
    expect(range.endDate).toBe("2026-07-22");
    expect(range.maxDate).toBe("2026-07-13");
  });

  it("accepts bounded custom dates and derives the equal prior period", () => {
    const range = resolveReportDateRange({
      key: "custom",
      minDate: "2025-01-01",
      maxDate: "2026-07-13",
      startDate: "2026-07-01",
      endDate: "2026-07-10",
      today: "2026-07-22",
    });
    expect(range.startDate).toBe("2026-07-01");
    expect(range.endDate).toBe("2026-07-10");
    expect(previousReportRange(range)).toEqual({ startDate: "2026-06-21", endDate: "2026-06-30" });
  });

  it("separates loaded dates from trailing not-loaded dates and compares equal loaded spans", () => {
    const range = resolveReportDateRange({
      key: "30d",
      minDate: "2025-01-01",
      maxDate: "2026-07-13",
      today: "2026-07-22",
    });
    const coverage = reportCoverage(range);

    expect(coverage).toEqual({
      loadedStartDate: "2026-06-23",
      loadedEndDate: "2026-07-13",
      loadedDays: 21,
      unavailableStartDate: "2026-07-14",
      unavailableEndDate: "2026-07-22",
      unavailableDays: 9,
    });
    expect(previousReportCoverageRange(coverage)).toEqual({
      startDate: "2026-06-02",
      endDate: "2026-06-22",
    });
    expect(previousReportCoverageRange(coverage, "2026-06-23")).toBeNull();
  });

  it("represents a wholly unavailable requested window without reversed query dates", () => {
    const coverage = reportCoverage({
      key: "custom",
      label: "2026-07-14 through 2026-07-22",
      startDate: "2026-07-14",
      endDate: "2026-07-22",
      minDate: "2025-01-01",
      maxDate: "2026-07-13",
    });

    expect(coverage).toMatchObject({
      loadedStartDate: null,
      loadedEndDate: null,
      loadedDays: 0,
      unavailableStartDate: "2026-07-14",
      unavailableEndDate: "2026-07-22",
      unavailableDays: 9,
    });
    expect(previousReportCoverageRange(coverage)).toBeNull();
  });

  it("omits a prior comparison when the equal span predates loaded history", () => {
    const coverage = reportCoverage({
      key: "30d",
      label: "30 days",
      startDate: "2026-07-01",
      endDate: "2026-07-22",
      minDate: "2026-07-01",
      maxDate: "2026-07-13",
    });

    expect(coverage.loadedStartDate).toBe("2026-07-01");
    expect(previousReportCoverageRange(coverage, "2026-07-01")).toBeNull();
  });

  it("reports stale and missing data explicitly", () => {
    expect(calculateFreshness({ dataCurrentThrough: "2026-07-20", today: "2026-07-22", slaDays: 2 }).state)
      .toBe("current");
    expect(calculateFreshness({ dataCurrentThrough: "2026-07-19", today: "2026-07-22", slaDays: 2 }).state)
      .toBe("stale");
    expect(calculateFreshness({ dataCurrentThrough: null, today: "2026-07-22", slaDays: 2 }).state)
      .toBe("missing");
  });

  it("calculates prior-period change and handles a zero denominator", () => {
    expect(percentageChange(120, 100)).toBe(20);
    expect(percentageChange(12, 0)).toBeNull();
  });

  it("normalizes range and export allowlists", () => {
    expect(parsePodcastRange("custom")).toBe("custom");
    expect(parsePodcastRange("bogus")).toBe("30d");
    expect(parsePodcastExportReport("episodes")).toBe("episodes");
    expect(parsePodcastExportReport("shell-command")).toBeNull();
    expect(normalizeExportRange("2026-07-01", "2026-07-22", "2026-07-22"))
      .toEqual({ startDate: "2026-07-01", endDate: "2026-07-22" });
    expect(() => normalizeExportRange("2026-07-23", "2026-07-24", "2026-07-22")).toThrow(/valid export date/);
  });

  it("quotes CSV fields safely", () => {
    expect(rowsToCsv(["title", "count"], [["A, B", 2], ['A "quote"', 3], ["=HYPERLINK(\"bad\")", 4]]))
      .toBe('title,count\r\n"A, B",2\r\n"A ""quote""",3\r\n"\'=HYPERLINK(""bad"")",4\r\n');
  });
});
