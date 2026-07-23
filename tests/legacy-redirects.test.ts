import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projection = vi.hoisted(() => ({ identity: vi.fn() }));

vi.mock("@/lib/public-content-projection", () => ({
  getProjectedContentByIdentity: projection.identity,
}));

import redirects from "@/data/legacy-redirects.json";
import media from "@/data/public-media-manifest.json";
import {
  isReservedLegacyRedirectSource,
  isSafeLegacyRedirectTarget,
  legacyRedirectCount,
  resolveLegacyRedirect,
  resolvePublicLegacyRedirect,
} from "@/lib/legacy-redirects";

beforeEach(() => {
  process.env.PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED = "true";
  projection.identity.mockReset();
  projection.identity.mockResolvedValue({ status: "absent" });
});

afterEach(() => {
  delete process.env.PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED;
  delete process.env.STRAPI_PUBLIC_URL;
  delete process.env.STRAPI_URL;
  delete process.env.STRAPI_READ_TOKEN;
  delete process.env.STRAPI_API_TOKEN;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("generated legacy redirect integrity", () => {
  it("cannot override current private, API, login, or asset routes", () => {
    for (const path of ["/admin", "/api/private", "/content/pages", "/login", "/_next/static/file.js", "/privacy", "/privacy/archive"]) {
      expect(isReservedLegacyRedirectSource(path)).toBe(true);
      expect(resolveLegacyRedirect(path)).toBeNull();
    }
  });

  it("never asks Strapi for a redirect that could shadow the GPT privacy route", async () => {
    process.env.STRAPI_PUBLIC_URL = "https://cms.example.test";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolvePublicLegacyRedirect("/privacy/")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("uses a valid active content-manager redirect immediately", async () => {
    process.env.STRAPI_PUBLIC_URL = "https://cms.example.test";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{
      documentId: "managed-1",
      fromPath: "/managed-old/",
      toPath: "/radio/managed-current/",
      statusCode: 308,
      active: true,
      archivedAt: null,
    }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolvePublicLegacyRedirect("/managed-old")).resolves.toMatchObject({
      fromPath: "/managed-old/",
      toPath: "/radio/managed-current/",
      statusCode: 308,
    });
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("filters[fromPath][$eq]")).toBe("/managed-old/");
  });

  it("treats an inactive managed redirect as authoritative", async () => {
    process.env.STRAPI_PUBLIC_URL = "https://cms.example.test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{
      documentId: "managed-2",
      fromPath: "/managed-old/",
      toPath: "/radio/managed-current/",
      statusCode: 301,
      active: false,
    }] }), { status: 200 })));

    await expect(resolvePublicLegacyRedirect("/managed-old/")).resolves.toBeNull();
  });

  it("falls back to the generated snapshot only when Strapi is unavailable", async () => {
    process.env.STRAPI_PUBLIC_URL = "https://cms.example.test";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const generated = redirects[0];

    await expect(resolvePublicLegacyRedirect(generated.fromPath)).resolves.toEqual(resolveLegacyRedirect(generated.fromPath));
  });

  it("uses projected redirect state during an outage and lets tombstones suppress bootstrap rules", async () => {
    process.env.STRAPI_PUBLIC_URL = "https://cms.example.test";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const generated = redirects[0];

    projection.identity.mockResolvedValueOnce({
      status: "found",
      item: {
        documentId: "redirect-projected",
        fromPath: generated.fromPath,
        toPath: "/written-resources/",
        statusCode: 308,
        active: true,
      },
    });
    await expect(resolvePublicLegacyRedirect(generated.fromPath)).resolves.toMatchObject({
      toPath: "/written-resources/",
      statusCode: 308,
    });

    projection.identity.mockResolvedValueOnce({ status: "not-found" });
    await expect(resolvePublicLegacyRedirect(generated.fromPath)).resolves.toBeNull();
  });

  it("never lets a global managed redirect shadow the exact GPT privacy policy route", async () => {
    projection.identity.mockResolvedValue({
      status: "found",
      item: { fromPath: "/privacy/", toPath: "/privacy-terms-conditions/", statusCode: 301, active: true },
    });

    await expect(resolvePublicLegacyRedirect("/privacy/")).resolves.toBeNull();
    expect(projection.identity).not.toHaveBeenCalled();
  });

  it("rejects external and reserved managed targets", () => {
    expect(isSafeLegacyRedirectTarget("https://evil.example/path")).toBe(false);
    expect(isSafeLegacyRedirectTarget("/api/private/")).toBe(false);
    expect(isSafeLegacyRedirectTarget("/radio/current/")).toBe(true);
  });
});
