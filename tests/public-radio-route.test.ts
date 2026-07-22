import { beforeEach, describe, expect, it, vi } from "vitest";

const { notFound, getPublishedEpisodeBySlug } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  getPublishedEpisodeBySlug: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/components/pastor-wood-site", () => ({}));
vi.mock("@/lib/strapi-site-settings", () => ({ getStrapiSiteSettings: vi.fn() }));
vi.mock("@/lib/strapi-structured-public", () => ({
  getPublishedEpisodeBySlug,
  listPublishedBoardMembers: vi.fn(),
  listPublishedEndorsements: vi.fn(),
  listPublishedEpisodesPage: vi.fn(),
  listPublishedPostsPage: vi.fn(),
}));

import { PastorWoodStructuredRadioPage } from "@/components/pastor-wood-structured-listings";

describe("public radio detail route", () => {
  beforeEach(() => {
    getPublishedEpisodeBySlug.mockResolvedValue(null);
  });

  it("returns Next's real 404 for an unknown published episode slug", async () => {
    await expect(PastorWoodStructuredRadioPage({ slug: ["missing-episode"] })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getPublishedEpisodeBySlug).toHaveBeenCalledWith("missing-episode");
    expect(notFound).toHaveBeenCalledOnce();
  });
});
