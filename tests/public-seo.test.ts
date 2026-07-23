import { afterEach, describe, expect, it } from "vitest";

import { isPublicIndexingEnabled, publicCmsPageMetadata, publicMetadata, publicSiteOrigin } from "@/lib/public-seo";

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

  it("honors safe structured canonical, noindex, and social-image values", () => {
    process.env.PASTORWOOD_PUBLIC_URL = "https://www.pastorwood.org";
    const metadata = publicMetadata({
      title: "Structured title",
      description: "Structured description",
      path: "/writings/fallback/",
      canonicalUrl: "/writings/canonical/",
      noIndex: true,
      imageUrl: "/media/cms/share/image.jpg",
    });

    expect(metadata.alternates).toEqual({ canonical: "https://www.pastorwood.org/writings/canonical/" });
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(metadata.openGraph?.images).toEqual([{
      url: "https://www.pastorwood.org/media/cms/share/image.jpg",
      alt: "Structured title",
    }]);
  });

  it("falls back instead of emitting unsafe canonical or image schemes", () => {
    process.env.PASTORWOOD_PUBLIC_URL = "https://www.pastorwood.org";
    const metadata = publicMetadata({
      title: "Safe title",
      description: "Safe description",
      path: "/safe/",
      canonicalUrl: "javascript:alert(1)",
      imageUrl: "data:text/html,bad",
    });

    expect(metadata.alternates).toEqual({ canonical: "https://www.pastorwood.org/safe/" });
    expect(metadata.openGraph?.images).toEqual([{
      url: "https://www.pastorwood.org/images/pastorwood/smoky-mountain-church.png",
      alt: "Safe title",
    }]);
  });

  it("publishes canonical, noindex, and social-image fields while rejecting a protected canonical path", () => {
    process.env.PASTORWOOD_PUBLIC_URL = "https://www.pastorwood.org";
    const metadata = publicCmsPageMetadata({
      page: {
        title: "Custom page",
        canonicalUrl: "/our-story/",
        noIndex: true,
        socialImage: { url: "/media/cms/social-doc/share.jpg" },
      },
      fallbackTitle: "Fallback",
      fallbackDescription: "Description",
      path: "/custom-page/",
    });

    expect(metadata.alternates).toEqual({ canonical: "https://www.pastorwood.org/our-story/" });
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.openGraph?.images).toEqual([{ url: "https://www.pastorwood.org/media/cms/social-doc/share.jpg", alt: "Custom page" }]);
    expect(metadata.twitter?.images).toEqual(["https://www.pastorwood.org/media/cms/social-doc/share.jpg"]);

    const protectedCanonical = publicCmsPageMetadata({
      page: { title: "Custom page", canonicalUrl: "/content/site-pages" },
      fallbackTitle: "Fallback",
      fallbackDescription: "Description",
      path: "/custom-page/",
    });
    expect(protectedCanonical.alternates).toEqual({ canonical: "https://www.pastorwood.org/custom-page/" });
  });
});
