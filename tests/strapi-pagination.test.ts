import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getPublishedEpisodeByTrackId,
  getPublishedEpisodeByTrackIdResult,
  getPublishedEpisodeBySlug,
  getPublishedEpisodeBySlugResult,
  getPublishedPostBySlugResult,
  listAllPublishedEpisodes,
  listLatestPublishedPostsResult,
  listPublishedBoardMembers,
  listPublishedBoardMembersResult,
  listPublishedEndorsementsResult,
  listPublishedEpisodesPage,
} from "@/lib/strapi-structured-public";

const originalUrl = process.env.STRAPI_URL;

afterEach(() => {
  process.env.STRAPI_URL = originalUrl;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function episode(index: number) {
  return { documentId: `doc-${index}`, title: `Episode ${index}`, slug: `episode-${index}`, trackId: String(index), programDate: "2024-01-01" };
}

describe("published Strapi archive pagination", () => {
  it("looks up a detail slug directly instead of searching only the first page", async () => {
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

  it("looks up an encoded imported-sermon route by its permanent Track ID", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("filters[trackId][$eq]")).toBe("wp-sermon:14759");
      return new Response(JSON.stringify({
        data: [{ ...episode(14759), trackId: "wp-sermon:14759" }],
        meta: { pagination: { page: 1, pageSize: 1, pageCount: 1, total: 1 } },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPublishedEpisodeByTrackId(decodeURIComponent("wp-sermon%3A14759"));

    expect(result?.trackId).toBe("wp-sermon:14759");
  });

  it("walks every Strapi metadata page for sitemap generation", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    const requestedPages: number[] = [];
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("pagination[page]"));
      requestedPages.push(page);
      expect(url.searchParams.get("pagination[pageSize]")).toBe("100");
      const firstRecord = ((page - 1) * 100) + 1;
      const recordCount = Math.min(100, 300 - firstRecord + 1);
      const data = Array.from({ length: recordCount }, (_, index) => episode(firstRecord + index));
      return new Response(JSON.stringify({ data, meta: { pagination: { page, pageSize: 100, pageCount: 3, total: 300 } } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listAllPublishedEpisodes();

    expect(result).toHaveLength(300);
    expect(result[100]?.slug).toBe("episode-101");
    expect(result[249]?.slug).toBe("episode-250");
    expect(result.at(-1)?.slug).toBe("episode-300");
    expect(requestedPages).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("clamps an oversized page request so record 101 remains on page 2", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("pagination[page]")).toBe("2");
      expect(url.searchParams.get("pagination[pageSize]")).toBe("100");
      return new Response(JSON.stringify({
        data: [episode(101)],
        meta: { pagination: { page: 2, pageSize: 100, pageCount: 3, total: 300 } },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listPublishedEpisodesPage(2, 250);

    expect(result).toMatchObject({ page: 2, pageSize: 100, pageCount: 3, total: 300 });
    expect(result.items.map((item) => item.slug)).toEqual(["episode-101"]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("publishes the managed upload that the episode pipeline processes before a legacy external URL", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{
        ...episode(42),
        externalAudioUrl: "https://legacy.example/old.mp3",
        audio: { documentId: "audio-doc", url: "/uploads/new.mp3" },
      }],
      meta: { pagination: { page: 1, pageSize: 24, pageCount: 1, total: 1 } },
    }), { status: 200 })));

    const result = await listPublishedEpisodesPage(1, 24);

    expect(result.items[0]?.audioUrl).toBe("/media/cms/audio-doc/new.mp3");
  });

  it("normalizes populated post relations, references, media, and nested SEO safely", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("populate[author]")).toBe("*");
      expect(url.searchParams.get("populate[scriptureReferences]")).toBe("*");
      expect(url.searchParams.get("populate[relatedLinks]")).toBe("*");
      expect(url.searchParams.get("populate[featuredImage]")).toBe("*");
      expect(url.searchParams.get("populate[seo][populate]")).toBe("*");
      return new Response(JSON.stringify({
        data: [{
          documentId: "post-1",
          title: "Structured post",
          slug: "structured-post",
          contentType: "article",
          body: "<p>Body</p>",
          author: { documentId: "person-1", name: "Pastor Wood" },
          scriptureReferences: [
            { label: "John 1:1", translation: "ESV", url: "https://example.test/john" },
            { label: "Unsafe reference", url: "javascript:alert(1)" },
          ],
          relatedLinks: [
            { label: "Safe resource", url: "/resource/", description: "Read it" },
            { label: "Unsafe resource", url: "data:text/html,bad" },
          ],
          featuredImage: { documentId: "image-doc", url: "/uploads/image.jpg", alternativeText: "Bible" },
          seo: {
            title: "Search title",
            canonicalUrl: "/canonical/",
            noIndex: true,
            socialImage: { documentId: "share-doc", url: "/uploads/share.jpg" },
          },
        }],
        meta: { pagination: { page: 1, pageSize: 1, pageCount: 1, total: 1 } },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPublishedPostBySlugResult("structured-post");

    expect(result).toMatchObject({
      status: "found",
      item: {
        author: { name: "Pastor Wood" },
        featuredImageUrl: "/media/cms/image-doc/image.jpg",
        featuredImageAlt: "Bible",
        relatedLinks: [{ label: "Safe resource", url: "/resource/" }],
        seo: {
          title: "Search title",
          canonicalUrl: "/canonical/",
          noIndex: true,
          socialImageUrl: "/media/cms/share-doc/share.jpg",
        },
      },
    });
    if (result.status === "found") {
      expect(result.item.scriptureReferences[1]?.url).toBe("");
    }
  });

  it("applies bounded server-side archive search and year filters with Strapi pagination", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("status")).toBe("published");
      expect(url.searchParams.get("pagination[page]")).toBe("2");
      expect(url.searchParams.get("pagination[pageSize]")).toBe("24");
      expect(url.searchParams.get("filters[archivedAt][$null]")).toBe("true");
      expect(url.searchParams.get("filters[$or][0][title][$containsi]")).toBe("grace");
      expect(url.searchParams.get("filters[$or][1][summary][$containsi]")).toBe("grace");
      expect(url.searchParams.get("filters[$or][2][description][$containsi]")).toBe("grace");
      expect(url.searchParams.get("filters[$or][3][trackId][$containsi]")).toBe("grace");
      expect(url.searchParams.get("filters[programDate][$gte]")).toBe("2024-01-01");
      expect(url.searchParams.get("filters[programDate][$lt]")).toBe("2025-01-01");
      return new Response(JSON.stringify({
        data: [episode(25)],
        meta: { pagination: { page: 2, pageSize: 24, pageCount: 2, total: 25 } },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listPublishedEpisodesPage(2, 24, { query: "grace", year: 2024 });

    expect(result).toMatchObject({ available: true, page: 2, pageSize: 24, pageCount: 2, total: 25 });
    expect(result.items[0]?.trackId).toBe("25");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("distinguishes a valid zero-result archive from an unavailable Strapi response", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [],
      meta: { pagination: { page: 1, pageSize: 24, pageCount: 0, total: 0 } },
    }), { status: 200 })));

    await expect(listPublishedEpisodesPage(1, 24, { query: "no-match" })).resolves.toMatchObject({
      available: true,
      items: [],
      total: 0,
    });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(listPublishedEpisodesPage(1, 24, { query: "no-match" })).resolves.toMatchObject({
      available: false,
      items: [],
    });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "bad gateway payload" }), { status: 200 })));
    await expect(listPublishedEpisodesPage(1, 24, { query: "no-match" })).resolves.toMatchObject({
      available: false,
      items: [],
    });
  });

  it("distinguishes missing detail items from unavailable and malformed item lookups", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [],
      meta: { pagination: { page: 1, pageSize: 1, pageCount: 0, total: 0 } },
    }), { status: 200 })));

    await expect(getPublishedEpisodeBySlugResult("missing")).resolves.toEqual({ status: "not-found" });
    await expect(getPublishedEpisodeByTrackIdResult("missing")).resolves.toEqual({ status: "not-found" });
    await expect(getPublishedPostBySlugResult("missing")).resolves.toEqual({ status: "not-found" });

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    await expect(getPublishedEpisodeBySlugResult("temporarily-down")).resolves.toEqual({ status: "unavailable" });
    await expect(getPublishedEpisodeByTrackIdResult("temporarily-down")).resolves.toEqual({ status: "unavailable" });
    await expect(getPublishedPostBySlugResult("temporarily-down")).resolves.toEqual({ status: "unavailable" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [{ title: "Missing permanent identity" }],
      meta: { pagination: { page: 1, pageSize: 1, pageCount: 1, total: 1 } },
    }), { status: 200 })));
    await expect(getPublishedEpisodeBySlugResult("malformed")).resolves.toEqual({ status: "unavailable" });
    await expect(getPublishedEpisodeByTrackIdResult("malformed")).resolves.toEqual({ status: "unavailable" });
    await expect(getPublishedPostBySlugResult("malformed")).resolves.toEqual({ status: "unavailable" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [episode(42)],
      meta: { pagination: { page: 1, pageSize: 1, pageCount: 1, total: 1 } },
    }), { status: 200 })));
    await expect(getPublishedEpisodeBySlugResult("wrong-slug")).resolves.toEqual({ status: "unavailable" });
    await expect(getPublishedEpisodeByTrackIdResult("43")).resolves.toEqual({ status: "unavailable" });
    await expect(getPublishedPostBySlugResult("wrong-post")).resolves.toEqual({ status: "unavailable" });
  });

  it("preserves valid-empty and unavailable collection states for board members and endorsements", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [],
      meta: { pagination: { page: 1, pageSize: 100, pageCount: 0, total: 0 } },
    }), { status: 200 })));

    await expect(listPublishedBoardMembersResult()).resolves.toMatchObject({ available: true, items: [], total: 0 });
    await expect(listPublishedEndorsementsResult()).resolves.toMatchObject({ available: true, items: [], total: 0 });

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "bad gateway payload" }), { status: 200 })));
    await expect(listPublishedBoardMembersResult()).resolves.toMatchObject({ available: false, items: [] });
    await expect(listPublishedEndorsementsResult()).resolves.toMatchObject({ available: false, items: [] });
  });

  it("bounds the feed source to one latest published-post page", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("pagination[page]")).toBe("1");
      expect(url.searchParams.get("pagination[pageSize]")).toBe("100");
      expect(url.searchParams.get("sort")).toBe("publishDate:desc");
      return new Response(JSON.stringify({
        data: Array.from({ length: 100 }, (_, index) => ({
          documentId: `post-${index + 1}`,
          title: `Post ${index + 1}`,
          slug: `post-${index + 1}`,
          body: "Body",
        })),
        meta: { pagination: { page: 1, pageSize: 100, pageCount: 20, total: 2000 } },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listLatestPublishedPostsResult(100);

    expect(result.available).toBe(true);
    expect(result.items).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("marks the bounded latest-post window unavailable without returning partial feed data", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await listLatestPublishedPostsResult(100);

    expect(result).toEqual({ items: [], available: false, page: 1, pageSize: 100, pageCount: 0, total: 0 });
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
