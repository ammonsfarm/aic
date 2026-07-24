import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertManagedStrapiPageSlugAvailable,
  getManagedStrapiPage,
  getManagedStrapiPageSummary,
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
  it("populates page media without expanding the forbidden upload-file related field", async () => {
    const draft = {
      data: {
        ...page("page-builder", "Page builder"),
        socialImage: { id: 19, url: "/uploads/share.jpg", name: "share.jpg" },
        sections: [{
          id: 7,
          __component: "page-sections.gallery-section",
          heading: "Gallery",
          images: [
            { id: 21, url: "/uploads/one.jpg", name: "one.jpg", alternativeText: "First image" },
            { id: 22, url: "/uploads/two.jpg", name: "two.jpg", alternativeText: "Second image" },
          ],
          galleryColumns: "two",
        }],
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 200 }))
      .mockResolvedValueOnce(new Response("not published", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getManagedStrapiPage("page-builder");

    expect(result?.socialImage?.id).toBe(19);
    expect(result?.sections[0]).toMatchObject({
      component: "page-sections.gallery-section",
      galleryColumns: "two",
      images: [{ id: 21 }, { id: 22 }],
    });
    for (const [url] of fetchMock.mock.calls as Array<[URL]>) {
      expect(url.searchParams.get("populate[socialImage]")).toBe("true");
      expect(url.searchParams.get("populate[sections][populate]")).toBe("*");
      expect(url.toString()).not.toContain("socialImage%5D=%2A");
    }
  });

  it("reports draft, published, and archived page state for the shared workflow dashboard", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(payload([], 8, 1, 1))
      .mockResolvedValueOnce(payload([], 7, 1, 1))
      .mockResolvedValueOnce(payload([], 2, 1, 1))
      .mockResolvedValueOnce(payload([], 5, 1, 1));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getManagedStrapiPageSummary()).resolves.toEqual({
      total: 8,
      active: 7,
      draft: 1,
      published: 5,
      archived: 2,
    });
    const archivedUrl = fetchMock.mock.calls[2][0] as URL;
    const publishedUrl = fetchMock.mock.calls[3][0] as URL;
    expect(archivedUrl.searchParams.get("status")).toBe("draft");
    expect(archivedUrl.searchParams.get("filters[archivedAt][$notNull]")).toBe("true");
    expect(publishedUrl.searchParams.get("status")).toBe("published");
    expect(publishedUrl.searchParams.get("filters[archivedAt][$null]")).toBe("true");
  });

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
