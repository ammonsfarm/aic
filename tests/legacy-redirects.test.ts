import { describe, expect, it } from "vitest";

import redirects from "@/data/legacy-redirects.json";
import media from "@/data/public-media-manifest.json";
import { isReservedLegacyRedirectSource, legacyRedirectCount, resolveLegacyRedirect } from "@/lib/legacy-redirects";

describe("generated legacy redirect integrity", () => {
  it("cannot override current private, API, login, or asset routes", () => {
    for (const path of ["/admin", "/api/private", "/content/pages", "/login", "/_next/static/file.js"]) {
      expect(isReservedLegacyRedirectSource(path)).toBe(true);
      expect(resolveLegacyRedirect(path)).toBeNull();
    }
  });

  it("contains no self loops and all media targets exist in the verified manifest", () => {
    const mediaTargets = new Set(media.filter((entry) => entry.exists).map((entry) => entry.publicPath));
    for (const redirect of redirects) {
      expect(redirect.fromPath.replace(/\/+$/, "")).not.toBe(redirect.toPath.replace(/\/+$/, ""));
      expect(isReservedLegacyRedirectSource(redirect.fromPath)).toBe(false);
      if (redirect.toPath.startsWith("/media/legacy/")) expect(mediaTargets.has(redirect.toPath)).toBe(true);
    }
    expect(legacyRedirectCount()).toBe(redirects.length);
  });
});
