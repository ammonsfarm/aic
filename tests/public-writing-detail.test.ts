import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/pastor-wood-site", () => ({
  PastorWoodShell: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children),
  PageHero: ({ title, body }: { title: string; body: string }) => React.createElement(
    "header",
    null,
    React.createElement("h1", null, title),
    React.createElement("p", null, body),
  ),
}));
vi.mock("@/lib/strapi-structured-public", () => ({
  getPublishedPostBySlugResult: mocks.lookup,
  safePublicContentUrl: (value: unknown) => typeof value === "string" ? value : "",
}));

import WritingDetailPage, { generateMetadata } from "@/app/writings/[slug]/page";

beforeEach(() => {
  mocks.lookup.mockReset();
  mocks.notFound.mockClear();
});

describe("public writing detail availability", () => {
  it("uses a real 404 and noindex metadata only for a valid missing result", async () => {
    mocks.lookup.mockResolvedValue({ status: "not-found" });
    const props = { params: Promise.resolve({ slug: "missing-writing" }) };

    await expect(WritingDetailPage(props)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(generateMetadata(props)).resolves.toMatchObject({ robots: { index: false } });
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("renders a retryable alert and outage metadata when Strapi is unavailable", async () => {
    mocks.lookup.mockResolvedValue({ status: "unavailable" });
    const props = { params: Promise.resolve({ slug: "temporarily-down" }) };

    const markup = renderToStaticMarkup(await WritingDetailPage(props));
    const metadata = await generateMetadata(props);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("This writing is temporarily unavailable");
    expect(markup).toContain("not a missing page");
    expect(markup).toContain("Retry this writing");
    expect(metadata).toMatchObject({
      title: "Writing temporarily unavailable",
      robots: { index: false, follow: true, noarchive: true },
    });
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("renders published structured fields and honors writing SEO", async () => {
    mocks.lookup.mockResolvedValue({
      status: "found",
      item: {
        documentId: "post-1",
        title: "Grace and truth",
        slug: "grace-and-truth",
        contentType: "article",
        summary: "A summary",
        body: "<p>Main <strong>writing</strong>.</p>",
        publishDate: "2026-07-22T12:00:00.000Z",
        author: { documentId: "person-1", name: "Pastor Jim Wood", title: "", organization: "" },
        scriptureReferences: [{
          label: "John 1:14",
          book: "John",
          chapter: 1,
          verseStart: 14,
          verseEnd: null,
          translation: "ESV",
          url: "https://www.esv.org/John+1%3A14/",
        }],
        relatedLinks: [{ label: "Study guide", url: "/study-guide/", description: "Read next." }],
        featuredImageUrl: "/media/cms/image-doc/grace.jpg",
        featuredImageAlt: "Open Bible",
        featuredImageCaption: "John 1",
        seo: {
          title: "Grace search title",
          description: "Grace search description",
          canonicalUrl: "/writings/grace-canonical/",
          noIndex: true,
          socialImageUrl: "/media/cms/social-doc/share.jpg",
        },
      },
    });
    const props = { params: Promise.resolve({ slug: "grace-and-truth" }) };

    const markup = renderToStaticMarkup(await WritingDetailPage(props));
    const metadata = await generateMetadata(props);

    expect(markup).toContain('alt="Open Bible"');
    expect(markup).toContain("By Pastor Jim Wood");
    expect(markup).toContain("Scripture references");
    expect(markup).toContain("John 1:14");
    expect(markup).toContain("Related links");
    expect(markup).toContain('href="/study-guide/"');
    expect(metadata).toMatchObject({
      title: "Grace search title",
      description: "Grace search description",
      alternates: { canonical: "https://www.pastorwood.org/writings/grace-canonical/" },
      robots: { index: false, follow: true },
      openGraph: { images: [{ url: "https://www.pastorwood.org/media/cms/social-doc/share.jpg" }] },
    });
  });

  it("labels an existing-archive writing as degraded instead of presenting it as live Strapi content", async () => {
    mocks.lookup.mockResolvedValue({
      status: "found",
      degraded: true,
      item: {
        documentId: "aic-fallback-post:42",
        title: "Archived writing",
        slug: "archived-writing",
        contentType: "written-resource",
        summary: "Existing AIC archive copy.",
        body: "<p>Body</p>",
        publishDate: "2025-01-01",
      },
    });

    const markup = renderToStaticMarkup(await WritingDetailPage({ params: Promise.resolve({ slug: "archived-writing" }) }));

    expect(markup).toContain("Live publishing is temporarily unavailable");
    expect(markup).toContain("existing Abiding in Christ archive");
    expect(markup).toContain('role="status"');
  });
});
