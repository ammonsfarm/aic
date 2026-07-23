import { describe, expect, it } from "vitest";

import {
  canUseInternalReadConsole,
  canUseResearchConsole,
  consoleHomeHref,
  consoleNavForRole,
  type AicNavRole,
} from "@/lib/navigation";

function hrefsFor(role: AicNavRole) {
  return consoleNavForRole(role).map((item) => item.href);
}

describe("role-aware console navigation", () => {
  it("gives administrators the complete console", () => {
    expect(hrefsFor("Admin")).toEqual([
      "/overview",
      "/archive",
      "/sources",
      "/compose",
      "/content",
      "/podcast",
      "/pipeline",
      "/admin",
    ]);
    expect(consoleHomeHref("Admin")).toBe("/overview");
  });

  it("lands content managers in content without advertising redirect-only admin links", () => {
    expect(hrefsFor("Content Manager")).toEqual([
      "/archive",
      "/sources",
      "/compose",
      "/content",
      "/podcast",
      "/pipeline",
    ]);
    expect(hrefsFor("Content Manager")).not.toContain("/overview");
    expect(hrefsFor("Content Manager")).not.toContain("/admin");
    expect(consoleHomeHref("Content Manager")).toBe("/content");
  });

  it("shows research users research tools but no publishing or administration", () => {
    expect(hrefsFor("Research User")).toEqual([
      "/archive",
      "/sources",
      "/compose",
      "/podcast",
      "/pipeline",
    ]);
    expect(canUseResearchConsole("Research User")).toBe(true);
  });

  it("keeps read-only users on non-generating views", () => {
    expect(hrefsFor("Read Only")).toEqual(["/archive", "/sources", "/podcast", "/pipeline"]);
    expect(hrefsFor("Read Only")).not.toContain("/compose");
    expect(consoleHomeHref("Read Only")).toBe("/podcast");
    expect(canUseInternalReadConsole("Read Only")).toBe(true);
    expect(canUseResearchConsole("Read Only")).toBe(false);
  });

  it("gives the default User role only its safe landing dashboard", () => {
    expect(hrefsFor("User")).toEqual(["/podcast"]);
    expect(consoleHomeHref("User")).toBe("/podcast");
    expect(canUseInternalReadConsole("User")).toBe(false);
    expect(canUseResearchConsole("User")).toBe(false);
  });

  it("includes every active content-management destination", () => {
    const content = consoleNavForRole("Content Manager").find((item) => item.href === "/content");
    const childHrefs = content?.children?.map((item) => item.href) ?? [];

    expect(childHrefs).toContain("/content/site-settings");
    expect(childHrefs).toContain("/content/newsletters");
  });
});
