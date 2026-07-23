import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projection = vi.hoisted(() => ({ getMedia: vi.fn() }));

vi.mock("@/lib/public-content-projection", () => ({
  getProjectedPublicMedia: projection.getMedia,
}));

import { authorizedPublishedCmsMedia } from "@/lib/cms-public-media";
import { disablePastorWoodPublicCmsCutoverForTests, enablePastorWoodPublicCmsCutoverForTests } from "@/lib/pastorwood-public-cms-cutover";

beforeEach(() => {
  enablePastorWoodPublicCmsCutoverForTests();
  projection.getMedia.mockReset();
});

afterEach(() => {
  disablePastorWoodPublicCmsCutoverForTests();
});

describe("published media authorization projection", () => {
  it("delegates to the single indexed projected-parent authorization lookup", async () => {
    projection.getMedia.mockResolvedValue({
      documentId: "social-image-doc",
      url: "/uploads/social-image.jpg",
      mime: "image/jpeg",
      size: 2048,
    });

    await expect(authorizedPublishedCmsMedia("social-image-doc")).resolves.toMatchObject({
      documentId: "social-image-doc",
      url: "/uploads/social-image.jpg",
    });
    expect(projection.getMedia).toHaveBeenCalledOnce();
    expect(projection.getMedia).toHaveBeenCalledWith("social-image-doc");
  });
});
