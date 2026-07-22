import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cacheMocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => cacheMocks);

import { NextRequest } from "next/server";
import { POST } from "@/app/api/revalidate/strapi/route";

describe("Strapi public cache invalidation", () => {
  beforeEach(() => {
    cacheMocks.revalidatePath.mockReset();
    cacheMocks.revalidateTag.mockReset();
    process.env.STRAPI_REVALIDATE_SECRET = "test-revalidate-secret";
  });

  afterEach(() => {
    delete process.env.STRAPI_REVALIDATE_SECRET;
  });

  it("invalidates structured lists, details, redirects, sitemap, and media authorization on unpublish", async () => {
    const request = new NextRequest("https://www.pastorwood.org/api/revalidate/strapi", {
      method: "POST",
      headers: {
        authorization: "Bearer test-revalidate-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        event: "entry.unpublish",
        entry: { documentId: "media-document-1", slug: "a-writing" },
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(cacheMocks.revalidateTag).toHaveBeenCalledWith("strapi-structured", { expire: 0 });
    expect(cacheMocks.revalidateTag).toHaveBeenCalledWith("strapi-structured-redirects", { expire: 0 });
    expect(cacheMocks.revalidateTag).toHaveBeenCalledWith("strapi-public-media", { expire: 0 });
    expect(cacheMocks.revalidateTag).toHaveBeenCalledWith("strapi-public-media-media-document-1", { expire: 0 });
    expect(cacheMocks.revalidatePath).toHaveBeenCalledWith("/sitemap.xml", "page");
    expect(cacheMocks.revalidatePath).toHaveBeenCalledWith("/writings/[slug]", "page");
    expect(cacheMocks.revalidatePath).toHaveBeenCalledWith("/radio/[[...slug]]", "page");
  });
});
