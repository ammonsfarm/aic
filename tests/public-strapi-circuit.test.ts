import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projection = vi.hoisted(() => ({
  identity: vi.fn(),
  listAll: vi.fn(),
}));

vi.mock("@/lib/public-content-projection", () => ({
  getProjectedContentByIdentity: projection.identity,
  listAllProjectedContent: projection.listAll,
}));

import { getStrapiPageByPageKeyResult } from "@/lib/strapi";
import { disablePastorWoodPublicCmsCutoverForTests, enablePastorWoodPublicCmsCutoverForTests } from "@/lib/pastorwood-public-cms-cutover";
import { getPublishedPageSitemapListing } from "@/lib/strapi-public-pages";
import { resetPublicStrapiCircuitForTests } from "@/lib/strapi-request";
import { getPublishedManagedSiteSettings } from "@/lib/strapi-site-settings-management";
import { getStrapiSiteSettings } from "@/lib/strapi-site-settings";

beforeEach(() => {
  resetPublicStrapiCircuitForTests();
  enablePastorWoodPublicCmsCutoverForTests();
  process.env.STRAPI_URL = "https://strapi.example.test";
  process.env.STRAPI_PUBLIC_URL = "https://strapi.example.test";
  process.env.STRAPI_API_TOKEN = "read-token";
  projection.identity.mockReset().mockResolvedValue({ status: "absent" });
  projection.listAll.mockReset().mockResolvedValue({ items: [], hasState: false });
});

afterEach(() => {
  resetPublicStrapiCircuitForTests();
  disablePastorWoodPublicCmsCutoverForTests();
  delete process.env.STRAPI_URL;
  delete process.env.STRAPI_PUBLIC_URL;
  delete process.env.STRAPI_API_TOKEN;
  delete process.env.STRAPI_PUBLIC_FETCH_TIMEOUT_MS;
  delete process.env.STRAPI_PUBLIC_CIRCUIT_COOLDOWN_MS;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("public Strapi outage circuit", () => {
  it("suppresses repeated public probes, leaves management live, and recovers through one half-open probe", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    let resolveRecovery: ((response: Response) => void) | undefined;
    const recovery = new Promise<Response>((resolve) => {
      resolveRecovery = resolve;
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          documentId: "settings-admin",
          siteName: "Protected settings",
          subscriptionEnabled: false,
        },
      }), { status: 200 }))
      .mockReturnValueOnce(recovery)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(getStrapiPageByPageKeyResult("home")).resolves.toEqual({ status: "unavailable" });
    await expect(getStrapiSiteSettings()).resolves.toBeNull();
    await expect(getPublishedPageSitemapListing()).resolves.toEqual({ entries: [], source: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(getPublishedManagedSiteSettings()).resolves.toMatchObject({
      documentId: "settings-admin",
      siteName: "Protected settings",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    now.mockReturnValue(31_001);
    const recoveryProbe = getStrapiPageByPageKeyResult("home");
    await expect(getStrapiSiteSettings()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    resolveRecovery?.(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await expect(recoveryProbe).resolves.toEqual({ status: "not-found" });

    const projectionCallsBeforeAuthoritativeEmpty = projection.identity.mock.calls.length;
    await expect(getStrapiSiteSettings()).resolves.toMatchObject({
      subscriptionPublishedEnabled: false,
      subscriptionEnabled: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(projection.identity).toHaveBeenCalledTimes(projectionCallsBeforeAuthoritativeEmpty);
  });
});
