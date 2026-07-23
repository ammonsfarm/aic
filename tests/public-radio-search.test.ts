import { describe, expect, it } from "vitest";

import {
  PUBLIC_RADIO_MAX_PAGE,
  PUBLIC_RADIO_QUERY_MAX_LENGTH,
  parsePublicRadioArchiveState,
  publicRadioArchivePath,
} from "@/lib/public-radio-search";

describe("public radio archive query parsing", () => {
  it("normalizes one bounded query value, year, and page", () => {
    const state = parsePublicRadioArchiveState({
      q: [`  grace\u0000   and\n truth ${"x".repeat(100)}  `, "ignored"],
      year: ["2024", "2023"],
      page: String(PUBLIC_RADIO_MAX_PAGE + 900),
    });

    expect(state.query).toMatch(/^grace and truth /);
    expect(Array.from(state.query)).toHaveLength(PUBLIC_RADIO_QUERY_MAX_LENGTH);
    expect(state.year).toBe(2024);
    expect(state.page).toBe(PUBLIC_RADIO_MAX_PAGE);
    expect(state.hasFilters).toBe(true);
  });

  it("rejects malformed years and pages without preserving attacker-controlled variants", () => {
    expect(parsePublicRadioArchiveState({ q: "  ", year: "2024 OR 1=1", page: "2.5" })).toEqual({
      query: "",
      year: null,
      page: 1,
      hasFilters: false,
    });
  });

  it("preserves page-aware archive paths while retaining active filters", () => {
    const unfiltered = parsePublicRadioArchiveState({ page: "3" });
    const filtered = parsePublicRadioArchiveState({ q: "grace & truth", year: "2024", page: "2" });

    expect(publicRadioArchivePath(unfiltered)).toBe("/radio/?page=3");
    expect(publicRadioArchivePath(filtered)).toBe("/radio/?q=grace+%26+truth&year=2024&page=2");
    expect(publicRadioArchivePath(filtered, 1)).toBe("/radio/?q=grace+%26+truth&year=2024");
  });
});
