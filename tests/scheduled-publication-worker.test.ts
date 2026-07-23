import { describe, expect, it, vi } from "vitest";

// @ts-expect-error The production worker is an executable ESM script without a TypeScript declaration file.
import { dueCollectionPath, runScheduledPublications } from "@/scripts/publish_scheduled_strapi_content.mjs";

describe("scheduled Strapi publication worker", () => {
  it("queries only due, non-archived drafts with a bounded page size", () => {
    const url = new URL(dueCollectionPath("posts", "2026-07-22T12:00:00.000Z", 25), "https://cms.test");
    expect(url.pathname).toBe("/api/posts");
    expect(url.searchParams.get("status")).toBe("draft");
    expect(url.searchParams.get("filters[scheduledFor][$lte]")).toBe("2026-07-22T12:00:00.000Z");
    expect(url.searchParams.get("filters[archivedAt][$null]")).toBe("true");
    expect(url.searchParams.get("pagination[pageSize]")).toBe("25");
  });

  it("publishes due entries with their exact version and a service actor", async () => {
    const requests: Array<{ url: URL; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      requests.push({ url, init });
      if (url.pathname === "/api/pages") {
        return new Response(JSON.stringify({
          data: [{ documentId: "page-1", updatedAt: "2026-07-22T11:59:00.000Z" }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname === "/api/posts" || url.pathname === "/api/episodes") {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ data: { documentId: "page-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(runScheduledPublications({
      baseUrl: "https://cms.test",
      token: "scoped-token",
      actorEmail: "publisher@example.test",
      now: "2026-07-22T12:00:00.000Z",
      limit: 25,
      fetchImpl: fetchMock,
    })).resolves.toEqual({ considered: 1, published: 1, skipped: 0, failed: 0 });

    const publication = requests.find((request) => request.url.pathname.endsWith("/publish-scheduled"));
    expect(publication?.url.pathname).toBe("/api/editorial/page/page-1/publish-scheduled");
    expect(JSON.parse(String(publication?.init.body))).toMatchObject({
      expectedUpdatedAt: "2026-07-22T11:59:00.000Z",
      actor: { id: "system:scheduled-publication", email: "publisher@example.test" },
    });
  });

  it("treats a stale locked publication as an idempotent skip", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/pages") {
        return new Response(JSON.stringify({ data: [{ documentId: "page-1", updatedAt: "old" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.pathname === "/api/posts" || url.pathname === "/api/episodes") {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("stale", { status: 400 });
    });

    await expect(runScheduledPublications({
      baseUrl: "https://cms.test",
      token: "scoped-token",
      actorEmail: "publisher@example.test",
      limit: 25,
      fetchImpl: fetchMock,
    })).resolves.toEqual({ considered: 1, published: 0, skipped: 1, failed: 0 });
  });
});
