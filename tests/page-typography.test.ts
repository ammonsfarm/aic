import { describe, expect, it } from "vitest";

import {
  isPageFontSize,
  normalizePageFontSize,
  PAGE_FONT_SIZE_OPTIONS,
} from "@/lib/page-typography";

describe("page typography presets", () => {
  it("accepts only the supported responsive presets", () => {
    expect(PAGE_FONT_SIZE_OPTIONS.map((option) => option.value)).toEqual(["small", "standard", "large"]);
    expect(isPageFontSize("small")).toBe(true);
    expect(isPageFontSize("72px")).toBe(false);
  });

  it("uses the standard preset for missing or invalid stored values", () => {
    expect(normalizePageFontSize(undefined)).toBe("standard");
    expect(normalizePageFontSize("enormous")).toBe("standard");
    expect(normalizePageFontSize("large")).toBe("large");
  });
});
