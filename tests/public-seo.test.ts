import { afterEach, describe, expect, it } from "vitest";

import { isPublicIndexingEnabled, publicSiteOrigin } from "@/lib/public-seo";

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
});
