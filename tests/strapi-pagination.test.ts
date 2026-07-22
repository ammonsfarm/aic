import { afterEach, describe, expect, it, vi } from "vitest";

import { getPublishedEpisodeBySlug, listAllPublishedEpisodes, listPublishedBoardMembers } from "@/lib/strapi-structured-public";

const originalUrl = process.env.STRAPI_URL;

afterEach(() => {
  process.env.STRAPI_URL = originalUrl;
  vi.unstubAllGlobals();
});

function episode(index: number) {
  return { documentId: `doc-${index}`, title: `Episode ${index}`, slug: `episode-${index}`, trackId: String(index), programDate: "2024-01-01" };
}

describe("published Strapi archive pagination", () => {
  it("looks up a detail slug directly instead of searching only the first 250", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("filters[slug][$eq]")).toBe("episode-3000");
      return new Response(JSON.stringify({ data: [episode(3000)], meta: { pagination: { page: 1, pageSize: 1, pageCount: 1, total: 1 } } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPublishedEpisodeBySlug("episode-3000");

    expect(result?.trackId).toBe("3000");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("walks every Strapi metadata page for sitemap generation", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const page = Number(new URL(String(input)).searchParams.get("pagination[page]"));
      const data = page === 1
        ? Array.from({ length: 250 }, (_, index) => episode(index + 1))
        : Array.from({ length: 50 }, (_, index) => episode(index + 251));
      return new Response(JSON.stringify({ data, meta: { pagination: { page, pageSize: 250, pageCount: 2, total: 300 } } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAllPublishedEpisodes();

    expect(result).toHaveLength(300);
    expect(result.at(-1)?.slug).toBe("episode-300");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("serves imported board portraits only through the verified same-origin legacy route", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [
        { documentId: "safe", name: "Safe Person", legacyPhotoUrl: "/media/legacy/2024/safe.jpg" },
        { documentId: "external", name: "External Person", legacyPhotoUrl: "https://evil.example/tracker.jpg" },
      ],
      meta: { pagination: { page: 1, pageSize: 100, pageCount: 1, total: 2 } },
    }), { status: 200 })));

    const result = await listPublishedBoardMembers();

    expect(result[0].photoUrl).toBe("/media/legacy/2024/safe.jpg");
    expect(result[1].photoUrl).toBe("");
  });
});
