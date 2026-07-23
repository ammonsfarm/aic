import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getPublishedEpisodeByTrackId,
  getPublishedEpisodeBySlug,
  listAllPublishedEpisodes,
  listPublishedBoardMembers,
  listPublishedEpisodesPage,
} from "@/lib/strapi-structured-public";

const originalUrl = process.env.STRAPI_URL;

afterEach(() => {
  process.env.STRAPI_URL = originalUrl;
  vi.unstubAllGlobals();
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
