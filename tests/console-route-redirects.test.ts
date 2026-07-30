import { describe, expect, it } from "vitest";

import { consolePathWithSearchParams } from "@/lib/console-route-redirects";

describe("console compatibility redirect query preservation", () => {
  it("preserves scalar and repeated search parameters", () => {
    expect(consolePathWithSearchParams("/console/episodes", {
      q: "grace and truth",
      scope: ["title", "theme"],
      empty: undefined,
    })).toBe("/console/episodes?q=grace+and+truth&scope=title&scope=theme");
  });

  it("does not append an empty query string", () => {
    expect(consolePathWithSearchParams("/console/research", {})).toBe("/console/research");
  });

  it("encodes query values rather than treating them as redirect targets", () => {
    expect(consolePathWithSearchParams("/console/sermons", { next: "https://evil.example" }))
      .toBe("/console/sermons?next=https%3A%2F%2Fevil.example");
  });
});
