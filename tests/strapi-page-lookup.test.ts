import { afterEach, describe, expect, it, vi } from "vitest";

import { getStrapiPageBySlugResult, strapiPageCacheTag } from "@/lib/strapi";

afterEach(() => {
  delete process.env.STRAPI_URL;
  delete process.env.STRAPI_API_TOKEN;
  delete process.env.STRAPI_PAGE_REVALIDATE_SECONDS;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dynamic CMS page lookup semantics", () => {
  it("reports unavailable when Strapi is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getStrapiPageBySlugResult("custom-page")).resolves.toEqual({ status: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("distinguishes a successful empty result from an outage", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 })));

    await expect(getStrapiPageBySlugResult("missing-page")).resolves.toEqual({ status: "not-found" });

    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));
    await expect(getStrapiPageBySlugResult("missing-page")).resolves.toEqual({ status: "unavailable" });
  });

  it("treats malformed successful payloads as unavailable rather than missing", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    for (const payload of [{ meta: {} }, { data: [null] }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })));
      await expect(getStrapiPageBySlugResult("unknown-page")).resolves.toEqual({ status: "unavailable" });
    }
  });

  it("returns published content through the existing tagged Next cache request", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    process.env.STRAPI_PAGE_REVALIDATE_SECONDS = "3600";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{
        documentId: "page-1",
        pageKey: "custom-page",
        slug: "custom-page",
        title: "Custom page",
        active: true,
        sections: [],
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getStrapiPageBySlugResult("custom-page");

    expect(result).toMatchObject({ status: "found", page: { slug: "custom-page", title: "Custom page" } });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit & { next?: { revalidate?: number; tags?: string[] } }];
    expect(url.searchParams.get("status")).toBe("published");
    expect(init.next?.revalidate).toBe(3600);
    expect(init.next?.tags).toContain(strapiPageCacheTag("custom-page"));
  });
});
