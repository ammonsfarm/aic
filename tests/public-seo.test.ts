import { afterEach, describe, expect, it } from "vitest";

import { isPublicIndexingEnabled, publicCmsPageMetadata, publicSiteOrigin } from "@/lib/public-seo";

const originalOrigin = process.env.PASTORWOOD_PUBLIC_URL;
const originalFlag = process.env.PASTORWOOD_ALLOW_INDEXING;

afterEach(() => {
  process.env.PASTORWOOD_PUBLIC_URL = originalOrigin;
  process.env.PASTORWOOD_ALLOW_INDEXING = originalFlag;
});

describe("public indexing gate", () => {
  it("fails closed for a development origin by default", () => {
    process.env.PASTORWOOD_PUBLIC_URL = "https://aic.ammonsfarm.org";
    delete process.env.PASTORWOOD_ALLOW_INDEXING;
    expect(publicSiteOrigin()).toBe("https://aic.ammonsfarm.org");
    expect(isPublicIndexingEnabled()).toBe(false);
  });

  it("requires both the production origin and explicit opt-in", () => {
    process.env.PASTORWOOD_PUBLIC_URL = "https://www.pastorwood.org";
    process.env.PASTORWOOD_ALLOW_INDEXING = "true";
    expect(isPublicIndexingEnabled()).toBe(true);
    process.env.PASTORWOOD_PUBLIC_URL = "https://aic.ammonsfarm.org";
    expect(isPublicIndexingEnabled()).toBe(false);
  });

  it("uses published CMS SEO with a canonical public URL and safe text fallbacks", () => {
    process.env.PASTORWOOD_PUBLIC_URL = "https://www.pastorwood.org";
    const metadata = publicCmsPageMetadata({
      page: {
        title: "Page title",
        heroTitle: "Hero title",
        heroBody: "<p>Hero &amp; description</p>",
        seoTitle: "CMS SEO title",
      },
      fallbackTitle: "Fallback title",
      fallbackDescription: "Fallback description",
      path: "/about-pastor-wood/",
      absoluteTitle: true,
    });

    expect(metadata.title).toEqual({ absolute: "CMS SEO title" });
    expect(metadata.description).toBe("Hero & description");
    expect(metadata.alternates).toEqual({ canonical: "https://www.pastorwood.org/about-pastor-wood/" });
  });
});
