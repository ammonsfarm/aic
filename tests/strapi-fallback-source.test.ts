import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fallback = vi.hoisted(() => ({
  episodesPage: vi.fn(),
  postsPage: vi.fn(),
  episodeBySlug: vi.fn(),
  episodeByTrackId: vi.fn(),
  postBySlug: vi.fn(),
}));
const projection = vi.hoisted(() => ({
  page: vi.fn(),
  all: vi.fn(),
  identity: vi.fn(),
}));

vi.mock("@/lib/pastorwood-public-fallback", () => ({
  getFallbackEpisodesPage: fallback.episodesPage,
  getFallbackPostsPage: fallback.postsPage,
  getFallbackEpisodeBySlug: fallback.episodeBySlug,
  getFallbackEpisodeByTrackId: fallback.episodeByTrackId,
  getFallbackPostBySlug: fallback.postBySlug,
}));
vi.mock("@/lib/public-content-projection", () => ({
  listProjectedContentPage: projection.page,
  listAllProjectedContent: projection.all,
  getProjectedContentByIdentity: projection.identity,
}));

import { listAllPublishedEpisodes } from "@/lib/strapi-structured-public";
import { resetPublicStrapiCircuitForTests } from "@/lib/strapi-request";

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
  resetPublicStrapiCircuitForTests();
  process.env.PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED = "true";
  process.env.STRAPI_URL = "http://127.0.0.1:1337";
  vi.restoreAllMocks();
  fallback.episodesPage.mockReset();
  fallback.postsPage.mockReset();
  fallback.episodeBySlug.mockReset();
  fallback.episodeByTrackId.mockReset();
  fallback.postBySlug.mockReset();
  projection.page.mockReset();
  projection.all.mockReset();
  projection.identity.mockReset();
  projection.page.mockResolvedValue({ items: [], page: 1, pageSize: 100, pageCount: 0, total: 0, hasState: false });
  projection.all.mockResolvedValue({ items: [], hasState: false });
  projection.identity.mockResolvedValue({ status: "absent" });
});

afterEach(() => {
  delete process.env.PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED;
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

  it("never returns a mixed partial archive when the all-page projection restart fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => {
      const page = Number(new URL(String(input)).searchParams.get("pagination[page]"));
      return page === 1
        ? new Response(JSON.stringify({
            data: [strapiEpisode(1)],
            meta: { pagination: { page: 1, pageSize: 100, pageCount: 2, total: 101 } },
          }), { status: 200 })
        : new Response("unavailable", { status: 503 });
    }));
    projection.page.mockResolvedValueOnce({
      items: [strapiEpisode(101)],
      page: 2,
      pageSize: 100,
      pageCount: 2,
      total: 101,
      hasState: true,
    });
    projection.all.mockRejectedValueOnce(new Error("projection restart failed"));

    await expect(listAllPublishedEpisodes()).resolves.toEqual([]);
    expect(fallback.episodesPage).not.toHaveBeenCalled();
  });
});
