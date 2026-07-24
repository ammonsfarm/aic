import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projection = vi.hoisted(() => ({ identity: vi.fn() }));

vi.mock("@/lib/public-content-projection", () => ({
  getProjectedContentByIdentity: projection.identity,
}));

import { getStrapiPageBySlugResult, strapiPageCacheTag } from "@/lib/strapi";
import { disablePastorWoodPublicCmsCutoverForTests, enablePastorWoodPublicCmsCutoverForTests } from "@/lib/pastorwood-public-cms-cutover";
import { resetPublicStrapiCircuitForTests } from "@/lib/strapi-request";

beforeEach(() => {
  resetPublicStrapiCircuitForTests();
  enablePastorWoodPublicCmsCutoverForTests();
  projection.identity.mockReset();
  projection.identity.mockResolvedValue({ status: "absent" });
});

afterEach(() => {
  disablePastorWoodPublicCmsCutoverForTests();
  delete process.env.STRAPI_URL;
  delete process.env.STRAPI_API_TOKEN;
  delete process.env.STRAPI_PAGE_REVALIDATE_SECONDS;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dynamic CMS page lookup semantics", () => {
  it("reports unavailable when Strapi is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getStrapiPageBySlugResult("custom-page")).resolves.toEqual({ status: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("distinguishes a successful empty result from an outage", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 })));

    await expect(getStrapiPageBySlugResult("missing-page")).resolves.toEqual({ status: "not-found" });

    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));
    await expect(getStrapiPageBySlugResult("missing-page")).resolves.toEqual({ status: "unavailable" });
  });

  it("treats malformed successful payloads as unavailable rather than missing", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    for (const payload of [
      null,
      [],
      "invalid",
      { meta: {} },
      { data: [null] },
      { data: [{ pageKey: "unknown-page" }] },
      { data: [{ pageKey: "unknown-page", slug: "unknown-page" }] },
      { data: [{ pageKey: "unknown-page", title: "Unknown page" }] },
      { data: [{ slug: "unknown-page", title: "Unknown page" }] },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })));
      await expect(getStrapiPageBySlugResult("unknown-page")).resolves.toEqual({ status: "unavailable" });
    }
  });

  it("returns published content through the existing tagged Next cache request", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    process.env.STRAPI_PAGE_REVALIDATE_SECONDS = "3600";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{
        documentId: "page-1",
        pageKey: "custom-page",
        slug: "custom-page",
        title: "Custom page",
        active: true,
        sections: [],
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getStrapiPageBySlugResult("custom-page");

    expect(result).toMatchObject({ status: "found", page: { slug: "custom-page", title: "Custom page" } });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit & { next?: { revalidate?: number; tags?: string[] } }];
    expect(url.searchParams.get("status")).toBe("published");
    expect(init.next?.revalidate).toBe(3600);
    expect(init.next?.tags).toContain(strapiPageCacheTag("custom-page"));
  });

  it("normalizes gallery, embed, form, and column sections from published Strapi data", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{
        documentId: "page-builder",
        pageKey: "page-builder",
        slug: "page-builder",
        title: "Page builder",
        active: true,
        sections: [
          {
            id: 1,
            __component: "page-sections.gallery-section",
            heading: "Gallery",
            galleryColumns: "four",
            images: [
              { id: 11, documentId: "image-11", url: "/uploads/one.jpg", alternativeText: "One", name: "one.jpg" },
              { id: 12, documentId: "image-12", url: "/uploads/two.jpg", alternativeText: "", name: "two.jpg" },
            ],
          },
          {
            id: 2,
            __component: "page-sections.embed-section",
            embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
            embedTitle: "Teaching video",
            embedAspectRatio: "standard",
          },
          {
            id: 3,
            __component: "page-sections.form-section",
            heading: "Contact us",
            formType: "contact",
          },
          {
            id: 4,
            __component: "page-sections.columns-section",
            columnCount: "three",
            columnOneHeading: "One",
            columnOneBody: "<p>First</p>",
            columnTwoHeading: "Two",
            columnTwoBody: "<p>Second</p>",
            columnThreeHeading: "Three",
            columnThreeBody: "<p>Third</p>",
          },
        ],
      }],
    }), { status: 200 })));

    const result = await getStrapiPageBySlugResult("page-builder");

    expect(result).toMatchObject({
      status: "found",
      page: {
        sections: [
          { component: "page-sections.gallery-section", galleryColumns: "four", images: [{ id: 11 }, { id: 12 }] },
          { component: "page-sections.embed-section", embedAspectRatio: "standard" },
          { component: "page-sections.form-section", formType: "contact" },
          { component: "page-sections.columns-section", columnCount: "three", columnThreeHeading: "Three" },
        ],
      },
    });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [URL];
    expect(url.searchParams.get("populate[socialImage]")).toBe("true");
  });

  it("uses a tombstone to suppress a stale page during an outage", async () => {
    process.env.STRAPI_URL = "http://127.0.0.1:1337";
    projection.identity.mockResolvedValue({ status: "not-found" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));

    await expect(getStrapiPageBySlugResult("removed-page")).resolves.toEqual({ status: "not-found" });
  });
});
