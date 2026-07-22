import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/strapi-public-pages", () => ({
  listAllPublishedPageSlugs: vi.fn(),
}));

vi.mock("@/lib/strapi-structured-public", () => ({
  listAllPublishedEpisodes: vi.fn(),
  listAllPublishedPosts: vi.fn(),
}));

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { publicArchiveCanonicalPath, publicArchivePage } from "@/lib/public-pagination";
import { PRIVATE_TOP_LEVEL_SEGMENTS } from "@/lib/route-access";
import { listAllPublishedPageSlugs } from "@/lib/strapi-public-pages";
import { listAllPublishedEpisodes, listAllPublishedPosts } from "@/lib/strapi-structured-public";

const originalOrigin = process.env.PASTORWOOD_PUBLIC_URL;
const originalIndexing = process.env.PASTORWOOD_ALLOW_INDEXING;

beforeEach(() => {
  process.env.PASTORWOOD_PUBLIC_URL = "https://www.pastorwood.org";
  process.env.PASTORWOOD_ALLOW_INDEXING = "true";
  vi.mocked(listAllPublishedPageSlugs).mockResolvedValue([]);
  vi.mocked(listAllPublishedPosts).mockResolvedValue([]);
  vi.mocked(listAllPublishedEpisodes).mockResolvedValue([]);
});

afterEach(() => {
  process.env.PASTORWOOD_PUBLIC_URL = originalOrigin;
  process.env.PASTORWOOD_ALLOW_INDEXING = originalIndexing;
});

describe("public archive SEO", () => {
  it("normalizes archive page numbers and preserves page-one canonicals", () => {
    expect(publicArchivePage(undefined)).toBe(1);
    expect(publicArchivePage("0")).toBe(1);
    expect(publicArchivePage("2.5")).toBe(1);
    expect(publicArchivePage("3")).toBe(3);
    expect(publicArchiveCanonicalPath("/radio/", 1)).toBe("/radio/");
    expect(publicArchiveCanonicalPath("/radio/", 3)).toBe("/radio/?page=3");
  });

  it("includes donor, published dynamic, post, and episode routes in the sitemap", async () => {
    vi.mocked(listAllPublishedPageSlugs).mockResolvedValue(["custom-resource", "admin", "bad/path"]);
    vi.mocked(listAllPublishedPosts).mockResolvedValue([
      { documentId: "post-1", slug: "written-item", title: "Written", contentType: "written", summary: "", body: "", publishDate: null },
    ]);
    vi.mocked(listAllPublishedEpisodes).mockResolvedValue([
      { documentId: "episode-1", slug: "radio-item", trackId: "1", title: "Radio", programDate: null, summary: "", description: "", audioUrl: "", durationSeconds: null },
    ]);

    const urls = new Set((await sitemap()).map((entry) => entry.url));

    expect(urls).toContain("https://www.pastorwood.org/donor-dashboard/");
    expect(urls).toContain("https://www.pastorwood.org/custom-resource/");
    expect(urls).toContain("https://www.pastorwood.org/writings/written-item/");
    expect(urls).toContain("https://www.pastorwood.org/radio/radio-item/");
    expect(urls).not.toContain("https://www.pastorwood.org/admin/");
    expect(urls).not.toContain("https://www.pastorwood.org/bad/path/");
  });

  it("keeps robots exclusions synchronized with every private route family", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const disallow = rules[0]?.disallow;
    const excluded = new Set(Array.isArray(disallow) ? disallow : disallow ? [disallow] : []);

    expect(excluded).toContain("/api/");
    expect(excluded).toContain("/login/");
    for (const segment of PRIVATE_TOP_LEVEL_SEGMENTS) {
      expect(excluded).toContain(`/${segment}/`);
    }
  });
});
