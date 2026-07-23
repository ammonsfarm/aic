import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/strapi-public-pages", () => ({
  getPublishedPageSitemapListing: vi.fn(),
}));

vi.mock("@/lib/strapi-structured-public", () => ({
  listAllPublishedEpisodes: vi.fn(),
  listAllPublishedPosts: vi.fn(),
}));

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { publicArchiveCanonicalPath, publicArchivePage } from "@/lib/public-pagination";
import { PRIVATE_TOP_LEVEL_SEGMENTS } from "@/lib/route-access";
import { getPublishedPageSitemapListing } from "@/lib/strapi-public-pages";
import { listAllPublishedEpisodes, listAllPublishedPosts } from "@/lib/strapi-structured-public";

const originalOrigin = process.env.PASTORWOOD_PUBLIC_URL;
const originalIndexing = process.env.PASTORWOOD_ALLOW_INDEXING;

beforeEach(() => {
  process.env.PASTORWOOD_PUBLIC_URL = "https://www.pastorwood.org";
  process.env.PASTORWOOD_ALLOW_INDEXING = "true";
  vi.mocked(getPublishedPageSitemapListing).mockResolvedValue({ entries: [], source: "unavailable" });
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
    vi.mocked(getPublishedPageSitemapListing).mockResolvedValue({
      source: "live",
      entries: [
        { documentId: "home", slug: "home", pageKey: "home", canonicalUrl: "", noIndex: false },
        { documentId: "donor", slug: "donor-dashboard", pageKey: "donor-dashboard", canonicalUrl: "", noIndex: false },
        { documentId: "custom", slug: "custom-resource", pageKey: "custom-resource", canonicalUrl: "", noIndex: false },
        { documentId: "admin", slug: "admin", pageKey: "admin", canonicalUrl: "", noIndex: false },
        { documentId: "bad", slug: "bad/path", pageKey: "bad-path", canonicalUrl: "", noIndex: false },
      ],
    });
    vi.mocked(listAllPublishedPosts).mockResolvedValue([
      {
        documentId: "post-1", slug: "written-item", title: "Written", contentType: "written", summary: "", body: "", publishDate: null,
        author: null, scriptureReferences: [], relatedLinks: [], featuredImageUrl: "", featuredImageAlt: "Written", featuredImageCaption: "",
        seo: { title: "", description: "", canonicalUrl: "", noIndex: false, socialImageUrl: "" },
      },
    ]);
    vi.mocked(listAllPublishedEpisodes).mockResolvedValue([
      {
        documentId: "episode-1", slug: "radio-item", trackId: "1", title: "Radio", programDate: null, summary: "", description: "", audioUrl: "", durationSeconds: null,
        guests: [], scriptureReferences: [], featuredImageUrl: "", featuredImageAlt: "Radio", featuredImageCaption: "",
        seo: { title: "", description: "", canonicalUrl: "", noIndex: false, socialImageUrl: "" },
      },
    ]);

    const urls = new Set((await sitemap()).map((entry) => entry.url));

    expect(urls).toContain("https://www.pastorwood.org/donor-dashboard/");
    expect(urls).toContain("https://www.pastorwood.org/custom-resource/");
    expect(urls).toContain("https://www.pastorwood.org/writings/written-item/");
    expect(urls).toContain("https://www.pastorwood.org/radio/radio-item/");
    expect(urls).not.toContain("https://www.pastorwood.org/admin/");
    expect(urls).not.toContain("https://www.pastorwood.org/bad/path/");
  });

  it("does not bootstrap fixed routes after live or projected page state exists", async () => {
    vi.mocked(getPublishedPageSitemapListing).mockResolvedValue({ entries: [], source: "live" });
    await expect(sitemap()).resolves.toEqual([]);

    vi.mocked(getPublishedPageSitemapListing).mockResolvedValue({ entries: [], source: "projection" });
    await expect(sitemap()).resolves.toEqual([]);

    vi.mocked(getPublishedPageSitemapListing).mockResolvedValue({ entries: [], source: "unavailable" });
    const bootstrapUrls = new Set((await sitemap()).map((entry) => entry.url));
    expect(bootstrapUrls).toContain("https://www.pastorwood.org/");
    expect(bootstrapUrls).toContain("https://www.pastorwood.org/privacy-terms-conditions/");
    expect(bootstrapUrls).not.toContain("https://www.pastorwood.org/privacy/");
  });

  it("honors noindex and same-site canonical URLs from structured SEO", async () => {
    vi.mocked(getPublishedPageSitemapListing).mockResolvedValue({
      source: "live",
      entries: [
        { documentId: "home", slug: "home", pageKey: "home", canonicalUrl: "/welcome/", noIndex: false },
        { documentId: "hidden", slug: "hidden", pageKey: "hidden", canonicalUrl: "", noIndex: true },
        { documentId: "external", slug: "external", pageKey: "external", canonicalUrl: "https://elsewhere.example/page", noIndex: false },
      ],
    });

    const urls = new Set((await sitemap()).map((entry) => entry.url));
    expect(urls).toContain("https://www.pastorwood.org/welcome/");
    expect(urls).not.toContain("https://www.pastorwood.org/hidden/");
    expect(urls).not.toContain("https://elsewhere.example/page");
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
