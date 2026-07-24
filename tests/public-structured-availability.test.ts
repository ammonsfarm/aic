import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  board: vi.fn(),
  endorsements: vi.fn(),
  posts: vi.fn(),
  settings: vi.fn(),
}));

vi.mock("@/components/pastor-wood-site", () => ({
  PastorWoodShell: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children),
  PageHero: ({ title }: { title: string }) => React.createElement("h1", null, title),
  DevotionalSignup: () => React.createElement("form", { "aria-label": "Devotional signup" }),
}));

vi.mock("@/lib/strapi-site-settings", () => ({ getStrapiSiteSettings: mocks.settings }));

vi.mock("@/lib/strapi-structured-public", () => ({
  getPublishedEpisodeBySlugResult: vi.fn(),
  listPublishedBoardMembersResult: mocks.board,
  listPublishedEndorsementsResult: mocks.endorsements,
  listPublishedEpisodesPage: vi.fn(),
  listPublishedPostsPage: mocks.posts,
  safePublicContentUrl: (value: unknown) => typeof value === "string" ? value : "",
}));

import {
  PastorWoodStructuredBoardPage,
  PastorWoodStructuredEndorsementsPage,
  PastorWoodStructuredPostsPage,
} from "@/components/pastor-wood-structured-listings";

const emptyPage = {
  items: [],
  page: 1,
  pageSize: 24,
  pageCount: 0,
  total: 0,
  available: true,
};

beforeEach(() => {
  mocks.board.mockReset();
  mocks.endorsements.mockReset();
  mocks.posts.mockReset();
  mocks.settings.mockReset();
  mocks.settings.mockResolvedValue({ subscriptionEnabled: true });
  mocks.board.mockResolvedValue({ ...emptyPage, pageSize: 100 });
  mocks.endorsements.mockResolvedValue({ ...emptyPage, pageSize: 100 });
  mocks.posts.mockResolvedValue(emptyPage);
});

describe("public structured collection availability", () => {
  it("renders intentional bootstrap collections without announcing an outage", async () => {
    mocks.board.mockResolvedValue({
      ...emptyPage,
      pageSize: 100,
      items: [{ documentId: "board-1", name: "Board Member", title: "Chair", organization: "", biography: "", photoUrl: "" }],
      total: 1,
      pageCount: 1,
      degraded: false,
      continuitySource: "bootstrap",
    });
    mocks.endorsements.mockResolvedValue({
      ...emptyPage,
      pageSize: 100,
      items: [{ documentId: "endorsement-1", quote: "A faithful ministry.", attribution: "Friend", title: "", organization: "", photoUrl: "" }],
      total: 1,
      pageCount: 1,
      degraded: false,
      continuitySource: "bootstrap",
    });
    mocks.posts.mockResolvedValue({
      ...emptyPage,
      items: [{ documentId: "post-1", title: "Existing writing", slug: "existing-writing", contentType: "written-resource", summary: "", publishDate: null }],
      total: 1,
      pageCount: 1,
      degraded: false,
      continuitySource: "bootstrap",
    });

    const markup = [
      renderToStaticMarkup(await PastorWoodStructuredBoardPage({})),
      renderToStaticMarkup(await PastorWoodStructuredEndorsementsPage({})),
      renderToStaticMarkup(await PastorWoodStructuredPostsPage({ mode: "written" })),
    ].join("\n");

    expect(markup).toContain("Board Member");
    expect(markup).toContain("A faithful ministry.");
    expect(markup).toContain("Existing writing");
    expect(markup).not.toContain("Live publishing is temporarily unavailable");
    expect(markup).not.toContain("reconnects");
  });

  it("renders valid-empty board and endorsement collections without claiming an outage", async () => {
    const board = renderToStaticMarkup(await PastorWoodStructuredBoardPage({}));
    const endorsements = renderToStaticMarkup(await PastorWoodStructuredEndorsementsPage({}));

    expect(board).toContain("No board members are published yet");
    expect(endorsements).toContain("No endorsements are published yet");
    expect(board).toContain('role="status"');
    expect(endorsements).toContain('role="status"');
    expect(board).not.toContain("Content temporarily unavailable");
    expect(endorsements).not.toContain("Content temporarily unavailable");
  });

  it("renders board and endorsement outages as alerts without claiming the collections are empty", async () => {
    mocks.board.mockResolvedValue({ ...emptyPage, pageSize: 100, available: false });
    mocks.endorsements.mockResolvedValue({ ...emptyPage, pageSize: 100, available: false });

    const board = renderToStaticMarkup(await PastorWoodStructuredBoardPage({}));
    const endorsements = renderToStaticMarkup(await PastorWoodStructuredEndorsementsPage({}));

    expect(board).toContain('role="alert"');
    expect(endorsements).toContain('role="alert"');
    expect(board).toContain("Content temporarily unavailable");
    expect(endorsements).toContain("Content temporarily unavailable");
    expect(board).not.toContain("No board members are published yet");
    expect(endorsements).not.toContain("No endorsements are published yet");
  });

  it("keeps valid-empty devotionals and writings distinct from content-service outages", async () => {
    const devotionalEmpty = renderToStaticMarkup(await PastorWoodStructuredPostsPage({ mode: "devotional" }));
    const writingsEmpty = renderToStaticMarkup(await PastorWoodStructuredPostsPage({ mode: "written" }));

    expect(devotionalEmpty).toContain("No devotionals are published yet");
    expect(writingsEmpty).toContain("No writings are published yet");
    expect(devotionalEmpty).not.toContain("Content temporarily unavailable");
    expect(writingsEmpty).not.toContain("Content temporarily unavailable");

    mocks.posts.mockResolvedValue({ ...emptyPage, available: false });
    const devotionalOutage = renderToStaticMarkup(await PastorWoodStructuredPostsPage({ mode: "devotional" }));
    const writingsOutage = renderToStaticMarkup(await PastorWoodStructuredPostsPage({ mode: "written" }));

    expect(devotionalOutage).toContain('role="alert"');
    expect(writingsOutage).toContain('role="alert"');
    expect(devotionalOutage).toContain("Content temporarily unavailable");
    expect(writingsOutage).toContain("Content temporarily unavailable");
    expect(devotionalOutage).not.toContain("No devotionals are published yet");
    expect(writingsOutage).not.toContain("No writings are published yet");
  });
});
