import { afterEach, describe, expect, it, vi } from "vitest";

import { listAllPublishedPageSlugs } from "@/lib/strapi-public-pages";

const originalPublicUrl = process.env.STRAPI_PUBLIC_URL;
const originalUrl = process.env.STRAPI_URL;

afterEach(() => {
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
      expect(url.searchParams.get("fields[0]")).toBe("slug");
      expect(url.searchParams.get("pagination[pageSize]")).toBe("100");
      const page = Number(url.searchParams.get("pagination[page]"));
      return new Response(JSON.stringify({
        data: page === 1
          ? Array.from({ length: 100 }, (_, index) => index === 0
              ? { attributes: { slug: "page-1" } }
              : { slug: `page-${index + 1}` })
          : [{ slug: "page-101" }],
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
        ? new Response(JSON.stringify({ data: [{ slug: "partial" }], meta: { pagination: { pageCount: 2 } } }), { status: 200 })
        : new Response("unavailable", { status: 503 });
    }));

    await expect(listAllPublishedPageSlugs()).resolves.toEqual([]);
  });
});
