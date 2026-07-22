import { describe, expect, it } from "vitest";

import {
  calculateFreshness,
  parsePodcastRange,
  percentageChange,
  previousReportRange,
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
