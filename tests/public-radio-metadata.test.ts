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
});
