import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { notFound, getPublishedEpisodeBySlug, listPublishedEpisodesPage } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  getPublishedEpisodeBySlug: vi.fn(),
  listPublishedEpisodesPage: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/components/pastor-wood-site", () => ({
  PastorWoodShell: ({ children }: { children: React.ReactNode }) => children,
  PageHero: ({ title }: { title: string }) => title,
}));
vi.mock("@/lib/strapi-site-settings", () => ({ getStrapiSiteSettings: vi.fn() }));
vi.mock("@/lib/strapi-structured-public", () => ({
  getPublishedEpisodeBySlug,
  listPublishedBoardMembers: vi.fn(),
  listPublishedEndorsements: vi.fn(),
  listPublishedEpisodesPage,
  listPublishedPostsPage: vi.fn(),
}));

import { PastorWoodStructuredRadioPage } from "@/components/pastor-wood-structured-listings";

describe("public radio detail route", () => {
  beforeEach(() => {
    notFound.mockClear();
    getPublishedEpisodeBySlug.mockResolvedValue(null);
    listPublishedEpisodesPage.mockReset();
  });

  it("returns Next's real 404 for an unknown published episode slug", async () => {
    await expect(PastorWoodStructuredRadioPage({ slug: ["missing-episode"] })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getPublishedEpisodeBySlug).toHaveBeenCalledWith("missing-episode");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("renders an accessible search form and a distinct archive outage state", async () => {
    listPublishedEpisodesPage.mockResolvedValue({
      items: [], page: 1, pageSize: 24, pageCount: 0, total: 0, available: false,
    });

    const markup = renderToStaticMarkup(await PastorWoodStructuredRadioPage({
      archive: { page: 1, query: "grace", year: 2024, hasFilters: true },
    }));

    expect(markup).toContain('role="search"');
    expect(markup).toContain('aria-label="Search radio broadcasts"');
    expect(markup).toContain('name="q"');
    expect(markup).toContain('name="year"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Radio archive temporarily unavailable");
    expect(markup).not.toContain("No broadcasts match these filters");
    expect(listPublishedEpisodesPage).toHaveBeenCalledWith(1, 24, { query: "grace", year: 2024 });
  });

  it("renders a useful zero-result state when Strapi successfully returns no matches", async () => {
    listPublishedEpisodesPage.mockResolvedValue({
      items: [], page: 1, pageSize: 24, pageCount: 0, total: 0, available: true,
    });

    const markup = renderToStaticMarkup(await PastorWoodStructuredRadioPage({
      archive: { page: 1, query: "missing", year: null, hasFilters: true },
    }));

    expect(markup).toContain("No broadcasts match these filters");
    expect(markup).toContain("View the full archive");
    expect(markup).not.toContain('role="alert"');
  });

  it("preserves active filters in accessible archive pagination links", async () => {
    listPublishedEpisodesPage.mockResolvedValue({
      items: [{
        documentId: "episode-25",
        title: "Grace and truth",
        slug: "grace-and-truth",
        trackId: "25",
        programDate: "2024-04-01",
        summary: "A broadcast",
        description: "",
        audioUrl: "",
        durationSeconds: null,
      }],
      page: 2,
      pageSize: 24,
      pageCount: 3,
      total: 49,
      available: true,
    });

    const markup = renderToStaticMarkup(await PastorWoodStructuredRadioPage({
      archive: { page: 2, query: "grace", year: 2024, hasFilters: true },
    }));

    expect(markup).toContain('aria-label="Radio archive pages"');
    expect(markup).toContain('/radio?q=grace&amp;year=2024');
    expect(markup).toContain('/radio?q=grace&amp;year=2024&amp;page=3');
    expect(markup).toContain("49 broadcasts found.");
  });

  it("does not claim the archive is empty when only the requested page is out of range", async () => {
    listPublishedEpisodesPage.mockResolvedValue({
      items: [], page: 1000, pageSize: 24, pageCount: 178, total: 4247, available: true,
    });

    const markup = renderToStaticMarkup(await PastorWoodStructuredRadioPage({
      archive: { page: 1000, query: "", year: null, hasFilters: false },
    }));

    expect(markup).toContain("This archive page has no broadcasts");
    expect(markup).toContain("View the first results page");
    expect(markup).not.toContain("No broadcasts are published yet");
    expect(markup).not.toContain("Page 1000 of 178");
  });
});
