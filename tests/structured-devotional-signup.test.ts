import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStrapiSiteSettings: vi.fn(),
  listPublishedPostsPage: vi.fn(),
}));

vi.mock("@/components/pastor-wood-site", () => ({
  PastorWoodShell: "pastor-shell",
  PageHero: "page-hero",
  DevotionalSignup: "devotional-signup",
}));

vi.mock("@/lib/strapi-site-settings", () => ({
  getStrapiSiteSettings: mocks.getStrapiSiteSettings,
}));

vi.mock("@/lib/strapi-structured-public", () => ({
  getPublishedEpisodeBySlug: vi.fn(),
  listPublishedBoardMembers: vi.fn(),
  listPublishedEndorsements: vi.fn(),
  listPublishedEpisodesPage: vi.fn(),
  listPublishedPostsPage: mocks.listPublishedPostsPage,
}));

import { PastorWoodStructuredPostsPage } from "@/components/pastor-wood-structured-listings";

function elementsOfType(node: React.ReactNode, type: string): React.ReactElement[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => elementsOfType(child, type));
  }
  if (!React.isValidElement(node)) {
    return [];
  }
  const element = node as React.ReactElement<{ children?: React.ReactNode }>;
  return [
    ...(element.type === type ? [element] : []),
    ...elementsOfType(element.props.children, type),
  ];
}

beforeEach(() => {
  mocks.getStrapiSiteSettings.mockReset();
  mocks.listPublishedPostsPage.mockReset();
  mocks.listPublishedPostsPage.mockResolvedValue({ items: [], page: 1, pageCount: 1, total: 0 });
});

describe("weekly devotional signup visibility", () => {
  it("keeps the signup on the empty or unavailable devotional listing when enabled", async () => {
    mocks.getStrapiSiteSettings.mockResolvedValue({ subscriptionEnabled: true });

    const result = await PastorWoodStructuredPostsPage({ mode: "devotional" });
    const signups = elementsOfType(result, "devotional-signup");

    expect(signups).toHaveLength(1);
    expect(signups[0].props).toMatchObject({ sourcePath: "/bible-study/" });
  });

  it("respects the global subscription flag on the unavailable listing", async () => {
    mocks.getStrapiSiteSettings.mockResolvedValue({ subscriptionEnabled: false });

    const result = await PastorWoodStructuredPostsPage({ mode: "devotional" });

    expect(elementsOfType(result, "devotional-signup")).toHaveLength(0);
  });

  it("uses the same enabled behavior when devotional posts are populated", async () => {
    mocks.getStrapiSiteSettings.mockResolvedValue({ subscriptionEnabled: true });
    mocks.listPublishedPostsPage.mockResolvedValue({
      items: [{
        documentId: "post-1",
        contentType: "devotional",
        publishDate: "2026-07-22T12:00:00.000Z",
        slug: "grace-for-today",
        title: "Grace for Today",
        summary: "A devotional.",
      }],
      page: 1,
      pageCount: 1,
      total: 1,
    });

    const result = await PastorWoodStructuredPostsPage({ mode: "devotional" });

    expect(elementsOfType(result, "devotional-signup")).toHaveLength(1);
  });

  it("does not add the devotional signup to written resources", async () => {
    mocks.getStrapiSiteSettings.mockResolvedValue({ subscriptionEnabled: true });

    const result = await PastorWoodStructuredPostsPage({ mode: "written" });

    expect(elementsOfType(result, "devotional-signup")).toHaveLength(0);
  });
});
