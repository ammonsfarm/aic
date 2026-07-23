import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createManagedSiteSettingsWithWorkflow,
  getManagedSiteSettings,
  listManagedSiteSettingsRevisions,
  rollbackManagedSiteSettings,
  type ManagedSiteSettingsInput,
} from "@/lib/strapi-site-settings-management";

const user = {
  clerkUserId: "user-1",
  email: "editor@example.test",
  name: "Editor",
  role: "Content Manager" as const,
};

const input: ManagedSiteSettingsInput = {
  siteName: "Abiding in Christ",
  topNavigation: [],
  footerNavigation: [],
  utilityNavigation: [],
  footerText: "A ministry of Jim Wood.",
  copyrightText: "© 2026 Abiding in Christ",
  showDonateButton: true,
  donateButtonLabel: "Donate",
  donateButtonUrl: "/donate/",
  donorDashboardUrl: "https://www.pastorwood.org/donor-dashboard/",
  headerLogoId: null,
  subscriptionEnabled: true,
};

beforeEach(() => {
  process.env.STRAPI_URL = "https://strapi.example.test";
  process.env.STRAPI_API_TOKEN_TEMP_WRITE = "write-token";
});

afterEach(() => {
  delete process.env.STRAPI_URL;
  delete process.env.STRAPI_API_TOKEN_TEMP_WRITE;
  vi.unstubAllGlobals();
});

describe("site-settings editorial management", () => {
  it("treats an absent singleton as an initializable empty state", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: null }), {
      status: 404,
      headers: { "content-type": "application/json" },
    })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getManagedSiteSettings()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [draftUrl] = fetchMock.mock.calls[0] as [URL];
    const [publishedUrl] = fetchMock.mock.calls[1] as [URL];
    expect(draftUrl.pathname).toBe("/api/site-setting");
    expect(draftUrl.searchParams.get("status")).toBe("draft");
    expect(publishedUrl.pathname).toBe("/api/site-setting");
    expect(publishedUrl.searchParams.get("status")).toBe("published");
  });

  it("initializes the singleton through the attributed create workflow", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { documentId: "settings-1", ...input, publishedAt: null },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createManagedSiteSettingsWithWorkflow(input, user, "Initial settings")).resolves.toMatchObject({
      documentId: "settings-1",
      publicationStatus: "draft",
    });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/editorial/site-setting");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      actor: { id: "user-1", email: "editor@example.test" },
      note: "Initial settings",
      data: { subscriptionEnabled: true, headerLogo: null },
    });
  });

  it("rolls back through the workflow and exhaustively reads revision pages", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      documentId: `revision-${index + 1}`,
      revisionNumber: 101 - index,
      action: "save",
      actorEmail: "editor@example.test",
    }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: firstPage }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{
        documentId: "revision-101",
        revisionNumber: 1,
        action: "create",
        actorEmail: "editor@example.test",
      }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { documentId: "settings-1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listManagedSiteSettingsRevisions("settings-1")).resolves.toHaveLength(101);
    await rollbackManagedSiteSettings(
      "settings-1",
      "revision-101",
      user,
      "2026-07-22T12:00:00.000Z",
      "Restore baseline",
    );

    const [secondPageUrl] = fetchMock.mock.calls[1] as [URL];
    expect(secondPageUrl.searchParams.get("page")).toBe("2");
    const [rollbackUrl, rollbackInit] = fetchMock.mock.calls[2] as [URL, RequestInit];
    expect(rollbackUrl.pathname).toBe("/api/editorial/site-setting/settings-1/rollback");
    expect(JSON.parse(String(rollbackInit.body))).toMatchObject({
      revisionDocumentId: "revision-101",
      expectedUpdatedAt: "2026-07-22T12:00:00.000Z",
      note: "Restore baseline",
    });
  });
});
