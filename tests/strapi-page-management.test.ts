import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertManagedStrapiPageSlugAvailable,
  listManagedStrapiPages,
  listManagedStrapiPagesPage,
} from "@/lib/strapi-management";

function page(documentId: string, title = documentId) {
  return { documentId, pageKey: documentId, slug: documentId, title, updatedAt: "2026-07-22T12:00:00Z" };
}

function payload(data: unknown[], total: number, currentPage: number, pageSize: number) {
  return new Response(JSON.stringify({
    data,
    meta: {
      pagination: {
        page: currentPage,
        pageSize,
        pageCount: Math.ceil(total / pageSize),
        total,
      },
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  process.env.STRAPI_URL = "https://strapi.example.test";
  process.env.STRAPI_API_TOKEN_TEMP_WRITE = "test-token";
});

afterEach(() => {
  delete process.env.STRAPI_URL;
  delete process.env.STRAPI_API_TOKEN_TEMP_WRITE;
  vi.unstubAllGlobals();
});

describe("managed Strapi page inventory", () => {
  it("traverses every metadata page instead of stopping at 100", async () => {
    const firstHundred = Array.from({ length: 100 }, (_, index) => page(`page-${index + 1}`));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(payload(firstHundred, 101, 1, 100))
      .mockResolvedValueOnce(payload([], 0, 1, 100))
      .mockResolvedValueOnce(payload([page("page-101")], 101, 2, 100))
      .mockResolvedValueOnce(payload([], 0, 1, 1));
    vi.stubGlobal("fetch", fetchMock);

    const pages = await listManagedStrapiPages();

    expect(pages).toHaveLength(101);
    expect(pages.at(-1)?.documentId).toBe("page-101");
    const draftUrls = [fetchMock.mock.calls[0][0], fetchMock.mock.calls[2][0]] as URL[];
    expect(draftUrls.map((url) => url.searchParams.get("pagination[page]"))).toEqual(["1", "2"]);
    expect(draftUrls.every((url) => url.searchParams.get("status") === "draft")).toBe(true);
  });

  it("supports bounded server-side search and page metadata", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(payload([page("about", "About")], 3, 2, 50))
      .mockResolvedValueOnce(payload([{ ...page("about", "About"), publishedAt: "2026-07-22T12:00:00Z" }], 1, 1, 1));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listManagedStrapiPagesPage({ page: 2, search: `  ${"a".repeat(200)}  ` });

    expect(result.pagination).toMatchObject({ page: 2, pageSize: 50, total: 3 });
    expect(result.pages[0]).toMatchObject({ documentId: "about", publicationStatus: "published" });
    const [draftUrl] = fetchMock.mock.calls[0] as [URL];
    expect(draftUrl.searchParams.get("filters[$or][0][title][$containsi]")).toHaveLength(160);
    expect(draftUrl.searchParams.get("pagination[page]")).toBe("2");
  });

  it("checks slug uniqueness with an exact server-side query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(payload([page("other")], 1, 1, 1));
    vi.stubGlobal("fetch", fetchMock);

    await expect(assertManagedStrapiPageSlugAvailable("about", "current-page")).rejects.toThrow(
      "already used by another page",
    );
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.get("filters[slug][$eqi]")).toBe("about");
    expect(url.searchParams.get("filters[documentId][$ne]")).toBe("current-page");
    expect(url.searchParams.get("pagination[pageSize]")).toBe("1");
  });
});
