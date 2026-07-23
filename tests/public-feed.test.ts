import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildPublicPostsFeed,
  PUBLIC_FEED_BODY_MAX_CHARACTERS,
  PUBLIC_FEED_MAX_ITEMS,
} from "@/lib/public-feed";
import type { PublishedPost } from "@/lib/strapi-structured-public";

const originalOrigin = process.env.PASTORWOOD_PUBLIC_URL;

function post(overrides: Partial<PublishedPost> = {}): PublishedPost {
  return {
    documentId: "post-1",
    title: "Faith & Hope",
    slug: "faith-and-hope",
    contentType: "devotional",
    summary: "A <strong>short</strong> summary.",
    body: '<p>Safe body</p><script>alert("no")</script><a href="javascript:alert(1)">Unsafe link</a>',
    publishDate: "2026-07-20T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.PASTORWOOD_PUBLIC_URL = "https://www.pastorwood.org";
});

afterEach(() => {
  process.env.PASTORWOOD_PUBLIC_URL = originalOrigin;
});

describe("public posts RSS", () => {
  it("builds deterministic RSS 2.0 with canonical links and XML-safe sanitized content", () => {
    const feed = buildPublicPostsFeed([post()]);

    expect(feed).toContain('<rss version="2.0"');
    expect(feed).toContain('xmlns:content="http://purl.org/rss/1.0/modules/content/"');
    expect(feed).toContain('<atom:link href="https://www.pastorwood.org/feed/" rel="self" type="application/rss+xml" />');
    expect(feed).toContain("<title>Faith &amp; Hope</title>");
    expect(feed).toContain("<link>https://www.pastorwood.org/writings/faith-and-hope/</link>");
    expect(feed).toContain('<guid isPermaLink="true">https://www.pastorwood.org/writings/faith-and-hope/</guid>');
    expect(feed).toContain("<pubDate>Mon, 20 Jul 2026 12:00:00 GMT</pubDate>");
    expect(feed).toContain("&lt;p&gt;Safe body&lt;/p&gt;");
    expect(feed).not.toContain("<script");
    expect(feed).not.toContain("javascript:");
    expect(buildPublicPostsFeed([post()])).toBe(feed);
  });

  it("uses stable publication metadata, sorts newest first, and never invents a request-time date", () => {
    const feed = buildPublicPostsFeed([
      post({ documentId: "older", slug: "older", title: "Older", publishDate: "2020-01-01T00:00:00Z" }),
      post({ documentId: "invalid", slug: "undated", title: "Undated", publishDate: "not-a-date" }),
      post({ documentId: "newer", slug: "newer", title: "Newer", publishDate: "2024-06-01T00:00:00Z" }),
    ]);

    expect(feed.indexOf("<title>Newer</title>")).toBeLessThan(feed.indexOf("<title>Older</title>"));
    expect(feed).toContain("<lastBuildDate>Sat, 01 Jun 2024 00:00:00 GMT</lastBuildDate>");
    expect(feed).not.toContain("Invalid Date");
    expect(feed.match(/<pubDate>/g)).toHaveLength(2);
  });

  it("omits malformed entries that cannot have a safe canonical public route", () => {
    const feed = buildPublicPostsFeed([
      post({ documentId: "unsafe", slug: "../admin", title: "Unsafe" }),
      post({ documentId: "blank", slug: "valid-slug", title: "" }),
    ]);

    expect(feed).not.toContain("<item>");
    expect(feed).not.toContain("/admin");
  });

  it("bounds the latest-item count and per-item body while preserving a canonical continuation", () => {
    const posts = Array.from({ length: PUBLIC_FEED_MAX_ITEMS + 5 }, (_, index) => post({
      documentId: `post-${index}`,
      slug: `post-${index}`,
      title: `Post ${index}`,
      publishDate: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      body: index === PUBLIC_FEED_MAX_ITEMS + 4
        ? `<p>${"x".repeat(PUBLIC_FEED_BODY_MAX_CHARACTERS + 50)}END-MARKER</p>`
        : "Short body",
    }));

    const feed = buildPublicPostsFeed(posts);

    expect(feed.match(/<item>/g)).toHaveLength(PUBLIC_FEED_MAX_ITEMS);
    expect(feed).not.toContain("<title>Post 0</title>");
    expect(feed).not.toContain("END-MARKER");
    expect(feed).toContain("Continue reading on PastorWood.org");
  });

  it("makes safe root-relative content links and images usable outside the website", () => {
    const feed = buildPublicPostsFeed([post({
      body: '<p><a href="/contact/">Contact</a><img src="/images/pastorwood/example.png" alt="Example"></p>',
    })]);

    expect(feed).toContain("href=&quot;https://www.pastorwood.org/contact/&quot;");
    expect(feed).toContain("src=&quot;https://www.pastorwood.org/images/pastorwood/example.png&quot;");
  });
});
