import { beforeEach, describe, expect, it, vi } from "vitest";

const fallback = vi.hoisted(() => ({
  episodesPage: vi.fn(),
  postsPage: vi.fn(),
  episodeBySlug: vi.fn(),
  episodeByTrackId: vi.fn(),
  postBySlug: vi.fn(),
}));

vi.mock("@/lib/pastorwood-public-fallback", () => ({
  getFallbackEpisodesPage: fallback.episodesPage,
  getFallbackPostsPage: fallback.postsPage,
  getFallbackEpisodeBySlug: fallback.episodeBySlug,
  getFallbackEpisodeByTrackId: fallback.episodeByTrackId,
  getFallbackPostBySlug: fallback.postBySlug,
}));

import { listAllPublishedEpisodes } from "@/lib/strapi-structured-public";

function strapiEpisode(index: number) {
  return {
    documentId: `strapi-${index}`,
    title: `Strapi ${index}`,
    slug: `strapi-${index}`,
    trackId: `strapi-${index}`,
    programDate: "2026-01-01",
  };
}

function fallbackEpisode(index: number) {
  return {
    documentId: `fallback-${index}`,
    title: `Fallback ${index}`,
    slug: `fallback-${index}`,
    trackId: `fallback-${index}`,
    programDate: "2025-01-01",
    summary: "",
    description: "",
    audioUrl: "",
    durationSeconds: null,
  };
}

beforeEach(() => {
  process.env.STRAPI_URL = "http://127.0.0.1:1337";
  vi.restoreAllMocks();
  fallback.episodesPage.mockReset();
  fallback.postsPage.mockReset();
  fallback.episodeBySlug.mockReset();
  fallback.episodeByTrackId.mockReset();
  fallback.postBySlug.mockReset();
});

describe("published archive fallback source consistency", () => {
  it("discards partial Strapi pages and rebuilds entirely from the existing AIC fallback", async () => {
    const requestedStrapiPages: number[] = [];
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => {
      const page = Number(new URL(String(input)).searchParams.get("pagination[page]"));
      requestedStrapiPages.push(page);
      if (page === 1) {
        return new Response(JSON.stringify({
          data: [strapiEpisode(1)],
          meta: { pagination: { page: 1, pageSize: 100, pageCount: 3, total: 201 } },
        }), { status: 200 });
      }
      return new Response("unavailable", { status: 503 });
    }));
    fallback.episodesPage
      .mockResolvedValueOnce({ items: [fallbackEpisode(99)], page: 2, pageSize: 100, pageCount: 2, total: 2 })
      .mockResolvedValueOnce({ items: [fallbackEpisode(1)], page: 1, pageSize: 100, pageCount: 2, total: 2 })
      .mockResolvedValueOnce({ items: [fallbackEpisode(2)], page: 2, pageSize: 100, pageCount: 2, total: 2 });

    const result = await listAllPublishedEpisodes();

    expect(result.map((item) => item.documentId)).toEqual(["fallback-1", "fallback-2"]);
    expect(requestedStrapiPages).toEqual([1, 2]);
    expect(fallback.episodesPage.mock.calls.map(([page]) => page)).toEqual([2, 1, 2]);
  });
});
