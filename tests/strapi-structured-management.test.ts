import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteStructuredFile,
  getStructuredInventorySummary,
  listStructuredEntriesPage,
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
      "Permanent deletion",
      "Exact current title",
    );

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      note: "Permanent deletion",
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
});
