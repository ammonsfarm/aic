import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { notFound, getPublishedEpisodeBySlugResult, listPublishedEpisodesPage } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  getPublishedEpisodeBySlugResult: vi.fn(),
  listPublishedEpisodesPage: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/components/pastor-wood-site", () => ({
  PastorWoodShell: ({ children }: { children: React.ReactNode }) => children,
  PageHero: ({ title }: { title: string }) => title,
  DevotionalSignup: vi.fn(),
}));
vi.mock("@/lib/strapi-site-settings", () => ({ getStrapiSiteSettings: vi.fn() }));
vi.mock("@/lib/strapi-structured-public", () => ({
  getPublishedEpisodeBySlugResult,
  listPublishedBoardMembersResult: vi.fn(),
  listPublishedEndorsementsResult: vi.fn(),
  listPublishedEpisodesPage,
  listPublishedPostsPage: vi.fn(),
  safePublicContentUrl: (value: unknown) => typeof value === "string" ? value : "",
}));

import { PastorWoodStructuredRadioPage } from "@/components/pastor-wood-structured-listings";

describe("public radio detail route", () => {
  beforeEach(() => {
    notFound.mockClear();
    getPublishedEpisodeBySlugResult.mockResolvedValue({ status: "not-found" });
    listPublishedEpisodesPage.mockReset();
  });

  it("returns Next's real 404 for an unknown published episode slug", async () => {
    await expect(PastorWoodStructuredRadioPage({ slug: ["missing-episode"] })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getPublishedEpisodeBySlugResult).toHaveBeenCalledWith("missing-episode");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("renders guests, scripture, featured imagery, and sanitized detail content", async () => {
    getPublishedEpisodeBySlugResult.mockResolvedValue({
      status: "found",
      item: {
        documentId: "episode-1",
        title: "Grace and truth",
        slug: "grace-and-truth",
        trackId: "42",
        programDate: "2026-07-22",
        summary: "A broadcast",
        description: '<p>Episode notes.</p><script>alert("bad")</script>',
        audioUrl: "/media/cms/audio-doc/episode.mp3",
        durationSeconds: 1200,
        guests: [
          { documentId: "person-1", name: "Guest One", title: "", organization: "" },
          { documentId: "person-2", name: "Guest Two", title: "", organization: "" },
        ],
        scriptureReferences: [{
          label: "Romans 8:1",
          book: "Romans",
          chapter: 8,
          verseStart: 1,
          verseEnd: null,
          translation: "ESV",
          url: "/scripture/romans-8/",
        }],
        featuredImageUrl: "/media/cms/image-doc/radio.jpg",
        featuredImageAlt: "Radio microphone",
        featuredImageCaption: "In the studio",
        seo: { title: "", description: "", canonicalUrl: "", noIndex: false, socialImageUrl: "" },
      },
    });

    const markup = renderToStaticMarkup(await PastorWoodStructuredRadioPage({ slug: ["grace-and-truth"] }));

    expect(markup).toContain('alt="Radio microphone"');
    expect(markup).toContain("Guests:");
    expect(markup).toContain("Guest One, Guest Two");
    expect(markup).toContain("Scripture references");
    expect(markup).toContain('href="/scripture/romans-8/"');
    expect(markup).toContain("Episode notes.");
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("alert");
  });

  it("renders a retryable outage instead of a false 404 when episode lookup is unavailable", async () => {
    getPublishedEpisodeBySlugResult.mockResolvedValue({ status: "unavailable" });

    const markup = renderToStaticMarkup(await PastorWoodStructuredRadioPage({ slug: ["temporarily-down"] }));

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Content temporarily unavailable");
    expect(markup).toContain("Retry this page");
    expect(markup).toContain('href="/radio/temporarily-down"');
    expect(notFound).not.toHaveBeenCalled();
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

  it("renders the intentional bootstrap archive without announcing an outage", async () => {
    listPublishedEpisodesPage.mockResolvedValue({
      items: [{
        documentId: "bootstrap-episode-1",
        title: "Existing broadcast",
        slug: "existing-broadcast",
        trackId: "42",
        programDate: "2024-04-01",
        summary: "A broadcast",
        description: "",
        audioUrl: "/media/episodes/42",
        durationSeconds: null,
      }],
      page: 1,
      pageSize: 24,
      pageCount: 1,
      total: 1,
      available: true,
      degraded: false,
      continuitySource: "bootstrap",
    });

    const markup = renderToStaticMarkup(await PastorWoodStructuredRadioPage({
      archive: { page: 1, query: "", year: null, hasFilters: false },
    }));

    expect(markup).toContain("Existing broadcast");
    expect(markup).toContain('aria-label="Play Existing broadcast"');
    expect(markup).not.toContain("Live publishing is temporarily unavailable");
    expect(markup).not.toContain("reconnects");
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
