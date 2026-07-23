import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getStrapiSiteSettings } from "@/lib/strapi-site-settings";

beforeEach(() => {
  process.env.STRAPI_URL = "https://strapi.example.test";
  process.env.STRAPI_API_TOKEN = "read-token";
});

afterEach(() => {
  delete process.env.STRAPI_URL;
  delete process.env.STRAPI_API_TOKEN;
  vi.unstubAllGlobals();
});

describe("public Strapi site settings", () => {
  it("publishes the managed logo through the authorized media route and carries the subscription flag", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        documentId: "settings-1",
        siteName: "Abiding in Christ",
        topNavigation: [],
        footerNavigation: [],
        utilityNavigation: [],
        showDonateButton: true,
        donateButtonLabel: "Donate",
        donateButtonUrl: "/donate/",
        donorDashboardUrl: "https://www.pastorwood.org/donor-dashboard/",
        subscriptionEnabled: false,
        headerLogo: {
          id: 7,
          documentId: "logo-document",
          name: "wordmark.png",
          alternativeText: "Abiding in Christ",
          url: "/uploads/wordmark_123.png",
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getStrapiSiteSettings()).resolves.toMatchObject({
      subscriptionEnabled: false,
      headerLogo: {
        url: "/media/cms/logo-document/wordmark_123.png",
        alternativeText: "Abiding in Christ",
      },
    });
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.get("status")).toBe("published");
    expect(url.searchParams.get("populate[headerLogo]")).toBe("*");
  });
});
