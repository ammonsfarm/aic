import { afterEach, describe, expect, it, vi } from "vitest";

import { authorizedPublishedCmsMedia } from "@/lib/cms-public-media";

const originalUrl = process.env.STRAPI_URL;
const originalReadToken = process.env.STRAPI_READ_TOKEN;

afterEach(() => {
  process.env.STRAPI_URL = originalUrl;
  process.env.STRAPI_READ_TOKEN = originalReadToken;
  vi.unstubAllGlobals();
});

describe("published page media authorization pagination", () => {
  it("finds media referenced after the first 100 published page records", async () => {
    process.env.STRAPI_URL = "https://strapi.example.test";
    process.env.STRAPI_READ_TOKEN = "read-token";
    const pageRequests: URL[] = [];
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname !== "/api/pages") {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }

      pageRequests.push(url);
      const page = Number(url.searchParams.get("pagination[page]"));
      const data = page === 1
        ? Array.from({ length: 100 }, (_, index) => ({ documentId: `page-${index + 1}`, sections: [] }))
        : [{
            documentId: "page-101",
            sections: [{
              image: {
                documentId: "media-page-101",
                url: "/uploads/page-101.jpg",
                mime: "image/jpeg",
                size: 1.5,
              },
            }],
          }];
      return new Response(JSON.stringify({
        data,
        meta: { pagination: { page, pageSize: 100, pageCount: 2, total: 101 } },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await authorizedPublishedCmsMedia("media-page-101");

    expect(result).toEqual({
      documentId: "media-page-101",
      url: "/uploads/page-101.jpg",
      mime: "image/jpeg",
      size: 1536,
    });
    expect(pageRequests.map((url) => url.searchParams.get("pagination[page]"))).toEqual(["1", "2"]);
    expect(pageRequests.every((url) => url.searchParams.get("pagination[pageSize]") === "100")).toBe(true);
    expect(pageRequests.every((url) => url.searchParams.get("status") === "published")).toBe(true);
    expect(pageRequests.every((url) => url.searchParams.get("populate[sections][populate]") === "*")).toBe(true);
    expect(pageRequests.every((url) => url.searchParams.get("populate[socialImage]") === "*")).toBe(true);
  });

  it("authorizes a social image attached to a published page", async () => {
    process.env.STRAPI_URL = "https://strapi.example.test";
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname !== "/api/pages") {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        data: [{
          documentId: "page-social",
          sections: [],
          socialImage: {
            documentId: "social-image-doc",
            url: "/uploads/social-image.jpg",
            mime: "image/jpeg",
            size: 2,
          },
        }],
        meta: { pagination: { page: 1, pageSize: 100, pageCount: 1, total: 1 } },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(authorizedPublishedCmsMedia("social-image-doc")).resolves.toEqual({
      documentId: "social-image-doc",
      url: "/uploads/social-image.jpg",
      mime: "image/jpeg",
      size: 2048,
    });
    const pageUrl = fetchMock.mock.calls.map(([input]) => new URL(String(input))).find((url) => url.pathname === "/api/pages");
    expect(pageUrl?.searchParams.get("populate[socialImage]")).toBe("*");
  });
});
