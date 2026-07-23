import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }));

vi.mock("@/lib/strapi", () => ({ getStrapiPageBySlugResult: mocks.lookup }));

import { shouldPreserveDynamicCmsPagePath } from "@/lib/public-dynamic-route-ownership";

describe("dynamic CMS route ownership", () => {
  beforeEach(() => {
    mocks.lookup.mockReset();
  });

  it("lets a published CMS page win before legacy redirect resolution", async () => {
    mocks.lookup.mockResolvedValue({ status: "found", page: { active: true } });

    await expect(shouldPreserveDynamicCmsPagePath("/published-page/")).resolves.toBe(true);
    expect(mocks.lookup).toHaveBeenCalledWith("published-page");
  });

  it("fails closed when dynamic page ownership cannot be checked", async () => {
    mocks.lookup.mockResolvedValue({ status: "unavailable" });

    await expect(shouldPreserveDynamicCmsPagePath("/possibly-published/")).resolves.toBe(true);
  });

  it("allows redirect resolution only after an authoritative page miss", async () => {
    mocks.lookup.mockResolvedValue({ status: "not-found" });

    await expect(shouldPreserveDynamicCmsPagePath("/legacy-slug/")).resolves.toBe(false);
  });

  it("does not query CMS pages for fixed, private, or multi-segment routes", async () => {
    for (const path of ["/radio/", "/admin/", "/writings/post/"]) {
      await expect(shouldPreserveDynamicCmsPagePath(path), path).resolves.toBe(false);
    }
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
});
