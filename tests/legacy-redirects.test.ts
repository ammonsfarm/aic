import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projection = vi.hoisted(() => ({ identity: vi.fn() }));

vi.mock("@/lib/public-content-projection", () => ({
  getProjectedContentByIdentity: projection.identity,
}));

import redirects from "@/data/legacy-redirects.json";
import media from "@/data/public-media-manifest.json";
import { disablePastorWoodPublicCmsCutoverForTests, enablePastorWoodPublicCmsCutoverForTests } from "@/lib/pastorwood-public-cms-cutover";
import { resetPublicStrapiCircuitForTests } from "@/lib/strapi-request";
import {
  isOwnedLegacyRedirectSource,
  isReservedLegacyRedirectSource,
  isSafeLegacyRedirectTarget,
  legacyRedirectCount,
  resolveLegacyRedirect,
  resolvePublicLegacyRedirect,
} from "@/lib/legacy-redirects";
import {
  PASTORWOOD_OWNED_PUBLIC_ROUTES,
  PASTORWOOD_PROTECTED_REDIRECT_PREFIXES,
} from "@/services/jimwood-cms/src/shared/pastorwood-redirect-policy";

beforeEach(() => {
  resetPublicStrapiCircuitForTests();
  enablePastorWoodPublicCmsCutoverForTests();
  projection.identity.mockReset();
  projection.identity.mockResolvedValue({ status: "absent" });
});

afterEach(() => {
  disablePastorWoodPublicCmsCutoverForTests();
  delete process.env.STRAPI_PUBLIC_URL;
  delete process.env.STRAPI_URL;
  delete process.env.STRAPI_READ_TOKEN;
  delete process.env.STRAPI_API_TOKEN;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("generated legacy redirect integrity", () => {
  it("cannot override current private, API, login, or asset routes", () => {
    for (const path of ["/admin", "/api/private", "/console/episodes/1", "/content/pages", "/episodes/1", "/login", "/podcast", "/reading-plan/day", "/sermons/1", "/_next/static/file.js", "/privacy", "/privacy/archive"]) {
      expect(isReservedLegacyRedirectSource(path)).toBe(true);
      expect(resolveLegacyRedirect(path)).toBeNull();
    }
    for (const prefix of PASTORWOOD_PROTECTED_REDIRECT_PREFIXES) {
      expect(isReservedLegacyRedirectSource(`${prefix}/nested`), prefix).toBe(true);
    }
  });

  it("never asks Strapi for a managed redirect that shadows an owned public route", async () => {
    process.env.STRAPI_PUBLIC_URL = "https://cms.example.test";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const path of PASTORWOOD_OWNED_PUBLIC_ROUTES) {
      expect(isOwnedLegacyRedirectSource(path), path).toBe(true);
      const variant = path === "/" ? path : path.replace(/\/+$/, "").toUpperCase();
      await expect(resolvePublicLegacyRedirect(variant), path).resolves.toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(projection.identity).not.toHaveBeenCalled();
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
    const sources = new Set(redirects.map((entry) => entry.fromPath.toLowerCase()));
    for (const redirect of redirects) {
      expect(redirect.fromPath.replace(/\/+$/, "")).not.toBe(redirect.toPath.replace(/\/+$/, ""));
      expect(isReservedLegacyRedirectSource(redirect.fromPath)).toBe(false);
      expect(sources.has(redirect.toPath.toLowerCase()), `${redirect.fromPath} creates a redirect chain`).toBe(false);
      if (redirect.toPath.startsWith("/media/legacy/")) expect(mediaTargets.has(redirect.toPath)).toBe(true);
    }
    expect(legacyRedirectCount()).toBe(redirects.length);
  });

  it("preserves intentional bootstrap aliases inside current route families", () => {
    const radioAlias = redirects.find((entry) => entry.fromPath.startsWith("/radio/"));
    const uploadAlias = redirects.find((entry) => entry.fromPath.startsWith("/wp-content/uploads/"));
    expect(radioAlias).toBeTruthy();
    expect(uploadAlias).toBeTruthy();
    expect(resolveLegacyRedirect(radioAlias!.fromPath)).toEqual(expect.objectContaining({ toPath: radioAlias!.toPath }));
    expect(resolveLegacyRedirect(uploadAlias!.fromPath)).toEqual(expect.objectContaining({ toPath: uploadAlias!.toPath }));
  });

  it("uses a valid active content-manager redirect immediately", async () => {
    process.env.STRAPI_PUBLIC_URL = "https://cms.example.test";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{
        documentId: "managed-1",
        fromPath: "/managed-old/",
        toPath: "/radio/managed-current/",
        statusCode: 308,
        active: true,
        archivedAt: null,
      }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolvePublicLegacyRedirect("/managed-old")).resolves.toMatchObject({
      fromPath: "/managed-old/",
      toPath: "/radio/managed-current/",
      statusCode: 308,
    });
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("filters[fromPath][$eq]")).toBe("/managed-old/");
  });

  it("fails closed when a managed redirect points to another managed redirect", async () => {
    process.env.STRAPI_PUBLIC_URL = "https://cms.example.test";
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = input instanceof URL ? input : new URL(String(input));
      const source = url.searchParams.get("filters[fromPath][$eq]")
        || url.searchParams.get("filters[fromPath][$eqi]");
      const data = source?.toLowerCase() === "/managed-old/"
        ? [{ documentId: "managed-a", fromPath: "/managed-old/", toPath: "/managed-middle/", statusCode: 308, active: true }]
        : [{ documentId: "managed-b", fromPath: "/managed-middle/", toPath: "/radio/final/", statusCode: 308, active: true }];
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolvePublicLegacyRedirect("/managed-old/")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = fetchMock.mock.calls[1]?.[0] as URL;
    expect(secondUrl.searchParams.get("filters[fromPath][$eqi]")).toBe("/managed-middle/");
  });

  it("fails closed when a managed rule targets an immutable bootstrap redirect source", async () => {
    process.env.STRAPI_PUBLIC_URL = "https://cms.example.test";
    const generated = redirects[0];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{
      documentId: "managed-bootstrap-chain",
      fromPath: "/managed-old/",
      toPath: generated.fromPath,
      statusCode: 301,
      active: true,
    }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolvePublicLegacyRedirect("/managed-old/")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

    projection.identity
      .mockResolvedValueOnce({
        status: "found",
        item: {
          documentId: "redirect-projected",
          fromPath: generated.fromPath,
          toPath: "/written-resources/",
          statusCode: 308,
          active: true,
        },
      })
      .mockResolvedValueOnce({ status: "not-found" });
    await expect(resolvePublicLegacyRedirect(generated.fromPath)).resolves.toMatchObject({
      toPath: "/written-resources/",
      statusCode: 308,
    });

    projection.identity.mockResolvedValueOnce({ status: "not-found" });
    await expect(resolvePublicLegacyRedirect(generated.fromPath)).resolves.toBeNull();
  });

  it("does not trust a projected redirect when destination graph state is unavailable", async () => {
    process.env.STRAPI_PUBLIC_URL = "https://cms.example.test";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    projection.identity
      .mockResolvedValueOnce({
        status: "found",
        item: {
          documentId: "redirect-projected",
          fromPath: "/managed-old/",
          toPath: "/managed-destination/",
          statusCode: 308,
          active: true,
        },
      })
      .mockResolvedValueOnce({ status: "absent" });

    await expect(resolvePublicLegacyRedirect("/managed-old/")).resolves.toBeNull();
    expect(projection.identity).toHaveBeenCalledTimes(2);
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
