import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projection = vi.hoisted(() => ({ getByIdentity: vi.fn() }));

vi.mock("@/lib/public-content-projection", () => ({
  getProjectedContentByIdentity: projection.getByIdentity,
}));

import { getStrapiSiteSettings } from "@/lib/strapi-site-settings";

beforeEach(() => {
  process.env.STRAPI_URL = "https://strapi.example.test";
  process.env.STRAPI_API_TOKEN = "read-token";
  projection.getByIdentity.mockReset();
  projection.getByIdentity.mockResolvedValue({ status: "absent" });
});

afterEach(() => {
  delete process.env.STRAPI_URL;
  delete process.env.STRAPI_API_TOKEN;
  vi.unstubAllEnvs();
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

  it("exposes the raw published subscription switch separately from provider readiness", async () => {
    for (const key of [
      "MAILCHIMP_API_KEY",
      "MAILCHIMP_SERVER_PREFIX",
      "MAILCHIMP_AUDIENCE_ID",
      "MAILCHIMP_WEBHOOK_SECRET",
      "SUBSCRIPTION_RATE_LIMIT_SECRET",
      "SUBSCRIPTION_UNSUBSCRIBE_SECRET",
    ]) {
      vi.stubEnv(key, "");
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        documentId: "settings-1",
        siteName: "Abiding in Christ",
        topNavigation: [],
        footerNavigation: [],
        utilityNavigation: [],
        subscriptionEnabled: true,
      },
    }), { status: 200 })));

    await expect(getStrapiSiteSettings()).resolves.toMatchObject({
      subscriptionPublishedEnabled: true,
      subscriptionEnabled: false,
    });
  });

  it("keeps the effective subscription flag off until the explicit runtime gate is enabled", async () => {
    for (const [key, value] of Object.entries({
      MAILCHIMP_API_KEY: "key-us21",
      MAILCHIMP_SERVER_PREFIX: "us21",
      MAILCHIMP_AUDIENCE_ID: "9ad7bbba36",
      MAILCHIMP_WEBHOOK_SECRET: "webhook",
      SUBSCRIPTION_RATE_LIMIT_SECRET: "rate",
      SUBSCRIPTION_UNSUBSCRIBE_SECRET: "unsubscribe",
      PASTORWOOD_SUBSCRIPTIONS_ENABLED: "false",
    })) {
      vi.stubEnv(key, value);
    }
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      data: { documentId: "settings-1", subscriptionEnabled: true },
    }), { status: 200 }))));

    await expect(getStrapiSiteSettings()).resolves.toMatchObject({
      subscriptionPublishedEnabled: true,
      subscriptionEnabled: false,
    });
    vi.stubEnv("PASTORWOOD_SUBSCRIPTIONS_ENABLED", "true");
    await expect(getStrapiSiteSettings()).resolves.toMatchObject({ subscriptionEnabled: true });
  });

  it("treats a successful live empty singleton as authoritative and does not resurrect projection settings", async () => {
    projection.getByIdentity.mockResolvedValue({
      status: "found",
      item: {
        siteName: "Stale settings",
        showDonateButton: true,
        donateButtonUrl: "https://give.example.org/stale",
        subscriptionEnabled: true,
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: null }), { status: 200 })));

    await expect(getStrapiSiteSettings()).resolves.toMatchObject({
      topNavigation: [],
      footerNavigation: [],
      showDonateButton: false,
      donateButtonUrl: "",
      donorDashboardUrl: "",
      subscriptionEnabled: false,
    });
    expect(projection.getByIdentity).not.toHaveBeenCalled();
  });

  it("drops navigation whose configured page relation is not publicly resolvable instead of using its stale URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        documentId: "settings-1",
        siteName: "Abiding in Christ",
        topNavigation: [
          { label: "Unpublished", url: "/stale-page/", page: { documentId: "page-1" } },
          { label: "Direct", url: "/contact/", page: null },
        ],
        footerNavigation: [],
        utilityNavigation: [],
      },
    }), { status: 200 })));

    await expect(getStrapiSiteSettings()).resolves.toMatchObject({
      topNavigation: [{ label: "Direct", href: "/contact/" }],
    });
  });

  it("uses an explicit projected tombstone as fail-closed settings during an outage", async () => {
    projection.getByIdentity.mockResolvedValue({ status: "not-found" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));

    await expect(getStrapiSiteSettings()).resolves.toMatchObject({
      topNavigation: [],
      showDonateButton: false,
      subscriptionEnabled: false,
    });
  });
});
