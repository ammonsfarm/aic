import { beforeEach, describe, expect, it, vi } from "vitest";

const { listLatestPublishedPostsResult } = vi.hoisted(() => ({
  listLatestPublishedPostsResult: vi.fn(),
}));

vi.mock("@/lib/strapi-structured-public", () => ({ listLatestPublishedPostsResult }));

import { GET } from "@/app/feed/route";

describe("legacy public feed route", () => {
  beforeEach(() => {
    listLatestPublishedPostsResult.mockReset();
  });

  it("serves a cacheable RSS document when the complete published collection is available", async () => {
    listLatestPublishedPostsResult.mockResolvedValue({ items: [], available: true });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=300, stale-while-revalidate=86400");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain('<rss version="2.0"');
    expect(listLatestPublishedPostsResult).toHaveBeenCalledWith(100);
  });

  it("returns a valid, non-cacheable retriable feed response instead of a partial feed during an outage", async () => {
    listLatestPublishedPostsResult.mockResolvedValue({ items: [], available: false });

    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("300");
    expect(response.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");
    expect(body).toContain('<rss version="2.0"');
    expect(body).not.toContain("<item>");
  });

  it("contains unexpected generation failures without leaking an HTML error response", async () => {
    listLatestPublishedPostsResult.mockRejectedValue(new Error("upstream unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/rss+xml");
    expect(await response.text()).toContain("<channel>");
  });
});
