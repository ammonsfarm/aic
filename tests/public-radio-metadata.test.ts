import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  episode: vi.fn(),
  page: vi.fn(),
}));

vi.mock("@/components/pastor-wood-structured-listings", () => ({ PastorWoodStructuredRadioPage: vi.fn() }));
vi.mock("@/lib/strapi", () => ({ getStrapiPageByPageKey: mocks.page }));
vi.mock("@/lib/strapi-structured-public", () => ({ getPublishedEpisodeBySlugResult: mocks.episode }));

import { generateMetadata } from "@/app/radio/[[...slug]]/page";

beforeEach(() => {
  mocks.episode.mockReset();
  mocks.page.mockReset();
});

describe("public radio detail metadata availability", () => {
  it("returns noindex-only metadata for a valid missing episode", async () => {
    mocks.episode.mockResolvedValue({ status: "not-found" });

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: ["missing-episode"] }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata).toEqual({ robots: { index: false } });
  });

  it("identifies an outage without presenting it as missing metadata", async () => {
    mocks.episode.mockResolvedValue({ status: "unavailable" });

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: ["temporarily-down"] }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata).toMatchObject({
      title: "Radio episode temporarily unavailable",
      robots: { index: false, follow: true, noarchive: true },
    });
  });

  it("honors all structured episode SEO controls", async () => {
    mocks.episode.mockResolvedValue({
      status: "found",
      item: {
        documentId: "episode-1",
        title: "Episode title",
        slug: "episode-title",
        summary: "Episode summary",
        featuredImageUrl: "",
        seo: {
          title: "Search title",
          description: "Search description",
          canonicalUrl: "/radio/canonical-episode/",
          noIndex: true,
          socialImageUrl: "/media/cms/share/episode.jpg",
        },
      },
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: ["episode-title"] }),
      searchParams: Promise.resolve({}),
    });

    expect(metadata).toMatchObject({
      title: "Search title",
      description: "Search description",
      alternates: { canonical: "https://www.pastorwood.org/radio/canonical-episode/" },
      robots: { index: false, follow: true },
      openGraph: { images: [{ url: "https://www.pastorwood.org/media/cms/share/episode.jpg" }] },
    });
  });
});
