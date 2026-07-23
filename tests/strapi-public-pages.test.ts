import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projection = vi.hoisted(() => ({ listAll: vi.fn() }));

vi.mock("@/lib/public-content-projection", () => ({
  listAllProjectedContent: projection.listAll,
}));

import { getPublishedPageSitemapListing, listAllPublishedPageSlugs } from "@/lib/strapi-public-pages";
import { resetPublicStrapiCircuitForTests } from "@/lib/strapi-request";

const originalPublicUrl = process.env.STRAPI_PUBLIC_URL;
const originalUrl = process.env.STRAPI_URL;

beforeEach(() => {
  resetPublicStrapiCircuitForTests();
  process.env.PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED = "true";
  projection.listAll.mockReset();
  projection.listAll.mockResolvedValue({ items: [], hasState: false });
});

afterEach(() => {
  delete process.env.PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED;
  process.env.STRAPI_PUBLIC_URL = originalPublicUrl;
  process.env.STRAPI_URL = originalUrl;
  vi.unstubAllGlobals();
});

describe("published CMS page sitemap enumeration", () => {
  it("walks every published, active, non-archived Strapi page", async () => {
    process.env.STRAPI_PUBLIC_URL = "http://127.0.0.1:1337";
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("filters[active][$eq]")).toBe("true");
      expect(url.searchParams.get("filters[archivedAt][$null]")).toBe("true");
      expect(url.searchParams.get("status")).toBe("published");
      expect(url.searchParams.get("fields[0]")).toBe("documentId");
      expect(url.searchParams.get("pagination[pageSize]")).toBe("100");
      const page = Number(url.searchParams.get("pagination[page]"));
      return new Response(JSON.stringify({
        data: page === 1
          ? Array.from({ length: 100 }, (_, index) => index === 0
              ? { attributes: { documentId: "doc-1", slug: "page-1", pageKey: "page-1" } }
              : { documentId: `doc-${index + 1}`, slug: `page-${index + 1}`, pageKey: `page-${index + 1}` })
          : [{ documentId: "doc-101", slug: "page-101", pageKey: "page-101" }],
        meta: { pagination: { page, pageSize: 100, pageCount: 2, total: 101 } },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const slugs = await listAllPublishedPageSlugs();

    expect(slugs).toHaveLength(101);
    expect(slugs).toContain("page-101");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed without throwing when a later Strapi page is unavailable", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    delete process.env.STRAPI_PUBLIC_URL;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => {
      const page = Number(new URL(String(input)).searchParams.get("pagination[page]"));
      return page === 1
        ? new Response(JSON.stringify({ data: [{ documentId: "partial", slug: "partial", pageKey: "partial" }], meta: { pagination: { pageCount: 2 } } }), { status: 200 })
        : new Response("unavailable", { status: 503 });
    }));

    await expect(listAllPublishedPageSlugs()).resolves.toEqual([]);
  });

  it("distinguishes authoritative live empty state from pre-projection bootstrap absence", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    delete process.env.STRAPI_PUBLIC_URL;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [],
      meta: { pagination: { page: 1, pageSize: 100, pageCount: 0, total: 0 } },
    }), { status: 200 })));

    await expect(getPublishedPageSitemapListing()).resolves.toEqual({ entries: [], source: "live" });
    expect(projection.listAll).not.toHaveBeenCalled();

    delete process.env.STRAPI_URL;
    projection.listAll.mockResolvedValueOnce({ items: [], hasState: false });
    await expect(getPublishedPageSitemapListing()).resolves.toEqual({ entries: [], source: "unavailable" });

    projection.listAll.mockResolvedValueOnce({ items: [], hasState: true });
    await expect(getPublishedPageSitemapListing()).resolves.toEqual({ entries: [], source: "projection" });
  });
});
