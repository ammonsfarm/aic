import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteStructuredFile,
  getEpisodeReprocessContextByTrackId,
  getStructuredEntry,
  getStructuredInventorySummary,
  listReusableMediaOptions,
  listStructuredEntriesPage,
  queueEpisodeReprocessByTrackId,
  transitionStructuredEntry,
} from "@/lib/strapi-structured-management";

function payload(data: unknown[], total: number, page = 1, pageSize = 50) {
  return new Response(JSON.stringify({
    data,
    meta: { pagination: { page, pageSize, pageCount: Math.ceil(total / pageSize), total } },
  }), { status: 200, headers: { "content-type": "application/json" } });
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

describe("structured Strapi inventory", () => {
  it("queues a full episode reprocess by exact canonical Track ID", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(payload([{
        documentId: "episode-123",
        trackId: "123",
        title: "Existing episode",
        updatedAt: "2026-07-24T10:00:00.000Z",
      }], 1, 1, 2))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { documentId: "request-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await queueEpisodeReprocessByTrackId(
      "123",
      { clerkUserId: "admin-1", email: "admin@example.test", name: "Admin", role: "Admin" },
      "Correct a transcript quality problem",
    );

    const [lookupUrl] = fetchMock.mock.calls[0] as [URL];
    expect(lookupUrl.searchParams.get("filters[trackId][$eq]")).toBe("123");
    expect(lookupUrl.searchParams.get("status")).toBe("draft");
    const [retryUrl, retryInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(retryUrl.pathname).toBe("/api/editorial/episode/episode-123/retry-processing");
    expect(retryInit.method).toBe("POST");
    expect(JSON.parse(String(retryInit.body))).toMatchObject({
      actor: { id: "admin-1", email: "admin@example.test" },
      expectedUpdatedAt: "2026-07-24T10:00:00.000Z",
      note: "Correct a transcript quality problem",
    });
  });

  it("loads the durable processing state for the admin episode action", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(payload([{
        documentId: "episode-123",
        trackId: "123",
        title: "Existing episode",
        updatedAt: "2026-07-24T10:00:00.000Z",
      }], 1, 1, 2))
      .mockResolvedValueOnce(payload([{
        documentId: "request-1",
        episodeDocumentId: "episode-123",
        trackId: "123",
        revisionNumber: 4,
        status: "running",
        attemptCount: 1,
        lastError: "",
        result: {},
      }], 1, 1, 1));
    vi.stubGlobal("fetch", fetchMock);

    const context = await getEpisodeReprocessContextByTrackId("123");

    expect(context?.episode.documentId).toBe("episode-123");
    expect(context?.processing?.status).toBe("running");
    const [processingUrl] = fetchMock.mock.calls[1] as [URL];
    expect(processingUrl.pathname).toBe("/api/episode-processing-requests");
    expect(processingUrl.searchParams.get("filters[episodeDocumentId][$eq]")).toBe("episode-123");
  });

  it("rejects unsafe Track IDs before contacting Strapi", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getEpisodeReprocessContextByTrackId("../bad")).rejects.toThrow("invalid permanent Track ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("populates editor relations without traversing private upload back-references", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("populate[seo][populate][socialImage]")).toBe("true");
      expect(url.searchParams.get("populate[featuredImage]")).toBe("true");
      expect(url.searchParams.get("populate[author]")).toBe("true");
      expect([...url.searchParams.values()]).not.toContain("*");
      const published = url.searchParams.get("status") === "published";
      return new Response(JSON.stringify({
        data: published ? null : {
          documentId: "post-1",
          updatedAt: "2026-07-22T12:00:00.000Z",
          seo: { id: 17, socialImage: { id: 23, name: "share.jpg" } },
        },
      }), { status: published ? 404 : 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const entry = await getStructuredEntry("posts", "post-1");

    expect(entry?.seo).toMatchObject({ id: 17, socialImage: { id: 23 } });
  });

  it("paginates the canonical draft inventory and joins published state by document id", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(payload([
        { documentId: "episode-1", title: "One", updatedAt: "2026-07-22T12:00:00Z" },
        { documentId: "episode-2", title: "Two", updatedAt: "2026-07-21T12:00:00Z" },
      ], 4_247, 2, 50))
      .mockResolvedValueOnce(payload([
        { documentId: "episode-1", title: "One", publishedAt: "2026-07-22T12:00:00Z" },
      ], 1, 1, 2));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listStructuredEntriesPage("episodes", { page: 2, search: "grace" });

    expect(result.pagination).toMatchObject({ page: 2, pageSize: 50, total: 4_247 });
    expect(result.entries.map((entry) => [entry.documentId, entry.isPublished])).toEqual([
      ["episode-1", true],
      ["episode-2", false],
    ]);
    const [draftUrl] = fetchMock.mock.calls[0] as [URL];
    expect(draftUrl.searchParams.get("status")).toBe("draft");
    expect(draftUrl.searchParams.get("pagination[page]")).toBe("2");
    expect(draftUrl.searchParams.get("filters[$or][0][title][$containsi]")).toBe("grace");
    const [publishedUrl] = fetchMock.mock.calls[1] as [URL];
    expect(publishedUrl.searchParams.getAll("filters[documentId][$in][0]")).toEqual(["episode-1"]);
  });

  it("uses metadata counts instead of truncating workflow totals at 100", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(payload([], 4_247, 1, 1))
      .mockResolvedValueOnce(payload([], 3, 1, 1))
      .mockResolvedValueOnce(payload([], 4_000, 1, 1));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getStructuredInventorySummary("episodes")).resolves.toEqual({
      total: 4_247,
      published: 4_000,
      draft: 244,
      archived: 3,
    });
    const urls = fetchMock.mock.calls.map(([url]) => url as URL);
    expect(urls[1].searchParams.get("filters[archivedAt][$notNull]")).toBe("true");
    expect(urls[2].searchParams.get("filters[archivedAt][$null]")).toBe("true");
    expect(urls[2].searchParams.get("status")).toBe("published");
  });

  it("carries the typed title into the locked delete workflow", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { documentId: "episode-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await transitionStructuredEntry(
      "episodes",
      "episode-1",
      "delete",
      { clerkUserId: "user-1", email: "editor@example.test", name: "Editor", role: "Content Manager" },
      "2026-07-22T12:00:00.000Z",
      "Permanent deletion",
      "Exact current title",
    );

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      note: "Permanent deletion",
      expectedUpdatedAt: "2026-07-22T12:00:00.000Z",
      expectedTitle: "Exact current title",
    });
  });

  it("can remove a rejected unattached upload through the scoped upload API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 41, name: "rejected-logo.png" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await deleteStructuredFile(41);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/upload/files/41");
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-token");
  });

  it("loads reusable files without recursively populating private upload relations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(payload([{
      documentId: "media-1",
      title: "Pastor portrait",
      visibility: "public",
      assetType: "image",
      asset: {
        id: 41,
        name: "pastor.jpg",
        url: "/uploads/pastor.jpg",
        mime: "image/jpeg",
        alternativeText: "Pastor Jim Wood",
      },
    }], 1, 1, 100));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listReusableMediaOptions()).resolves.toEqual([{
      id: 41,
      label: "Pastor portrait",
      url: "https://strapi.example.test/uploads/pastor.jpg",
      mime: "image/jpeg",
      assetType: "image",
      altText: "Pastor Jim Wood",
    }]);
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.searchParams.getAll("populate[0]")).toContain("asset");
    expect(url.searchParams.has("populate[asset]")).toBe(false);
  });
});
