import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getManagedStrapiPage,
  unpublishManagedStrapiPage,
  updateManagedStrapiPage,
  type ManagedStrapiPageInput,
} from "@/lib/strapi-management";
import {
  saveAndTransitionManagedSiteSettings,
} from "@/lib/strapi-site-settings-management";

const input: ManagedStrapiPageInput = {
  pageKey: "about",
  slug: "about-pastor-wood",
  title: "About",
  active: true,
  showInNavigation: true,
  navigationLabel: "About",
  navigationOrder: 10,
  heroLabel: "Biography",
  heroTitle: "Jim Wood",
  heroBody: "Biography",
  seoTitle: "About Jim Wood",
  seoDescription: "Biography",
  sections: [],
};

function entity(publishedAt: string | null = null) {
  return {
    data: {
      documentId: "document-1",
      ...input,
      publishedAt,
      updatedAt: "2026-07-22T12:00:00.000Z",
      createdAt: "2026-07-22T11:00:00.000Z",
    },
  };
}

beforeEach(() => {
  process.env.STRAPI_URL = "https://strapi.example.test";
  process.env.STRAPI_API_TOKEN_TEMP_WRITE = "test-token";
});

afterEach(() => {
  delete process.env.STRAPI_URL;
  delete process.env.STRAPI_API_TOKEN_TEMP_WRITE;
  vi.unstubAllGlobals();
});

describe("Strapi publication semantics", () => {
  it("sends an explicit published status only for a publish write", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(entity("2026-07-22T12:00:00.000Z")), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateManagedStrapiPage("document-1", input, "published");

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("status")).toBe("published");
    expect(init.method).toBe("PUT");
  });

  it("saves a draft with an explicit draft status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(entity()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateManagedStrapiPage("document-1", input, "draft");
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("status")).toBe("draft");
  });

  it("reports published state from the published variant, not the draft timestamp", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(entity()), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(entity("2026-07-22T12:00:00.000Z")), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const page = await getManagedStrapiPage("document-1");
    expect(page?.publicationStatus).toBe("published");
    expect(page?.publishedAt).toBe("2026-07-22T12:00:00.000Z");
  });

  it("unpublishes only the published variant and preserves the draft", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(entity()), { status: 200 }))
      .mockResolvedValueOnce(new Response("not published", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const page = await unpublishManagedStrapiPage("document-1");
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(deleteUrl.searchParams.get("status")).toBe("published");
    expect(deleteInit.method).toBe("DELETE");
    expect(page.publicationStatus).toBe("draft");
  });

  it("saves and publishes site settings in one attributed, version-fenced request", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(
        JSON.stringify({
          data: {
            documentId: "site-settings-1",
            siteName: "Abiding in Christ",
            topNavigation: [],
            footerNavigation: [],
            utilityNavigation: [],
            showDonateButton: true,
            publishedAt: "2026-07-22T12:00:00.000Z",
          },
        }),
        { status: 200 },
      ),
    ));
    vi.stubGlobal("fetch", fetchMock);

    const user = {
      clerkUserId: "user-1",
      email: "editor@example.test",
      name: "Editor",
      role: "Content Manager" as const,
    };
    await saveAndTransitionManagedSiteSettings("site-settings-1", "publish", {
      siteName: "Abiding in Christ",
      topNavigation: [{
        label: "About",
        url: "/about-pastor-wood/",
        pageDocumentId: "page-about",
        order: 10,
        active: true,
      }],
      footerNavigation: [],
      utilityNavigation: [],
      footerText: "A Ministry of Jim Wood",
      copyrightText: "2026",
      showDonateButton: true,
      donateButtonLabel: "Donate",
      donateButtonUrl: "/donate",
      headerLogoId: 17,
      subscriptionEnabled: true,
    }, user, "2026-07-22T11:59:00.000Z", "Publish global settings");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [publishUrl, publishInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(publishUrl.pathname).toBe("/api/editorial/site-setting/site-settings-1/publish");
    expect(publishInit.method).toBe("POST");
    expect(JSON.parse(String(publishInit.body))).toMatchObject({
      data: {
        headerLogo: 17,
        subscriptionEnabled: true,
        topNavigation: [{ page: "page-about" }],
      },
      actor: { id: "user-1", email: "editor@example.test" },
      expectedUpdatedAt: "2026-07-22T11:59:00.000Z",
      note: "Publish global settings",
    });
  });
});
