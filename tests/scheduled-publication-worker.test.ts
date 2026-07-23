import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-expect-error The production worker is an executable ESM script without a TypeScript declaration file.
import { dueCollectionPath, loadEnvFile, runScheduledPublicationCycle, runScheduledPublications } from "@/scripts/publish_scheduled_strapi_content.mjs";
// @ts-expect-error The production helper is an executable ESM script without a TypeScript declaration file.
import { flushPendingPublicCacheInvalidation, markPublicCacheInvalidationPending, PUBLIC_CACHE_INVALIDATION_URL, readPendingPublicCacheInvalidation } from "@/scripts/public_cache_invalidation.mjs";

const revalidationSecret = "a".repeat(64);

describe("scheduled Strapi publication worker", () => {
  it("returns canonical file values without copying them into inherited process state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scheduled-canonical-env-"));
    const envPath = join(directory, ".env");
    const inherited = process.env.STRAPI_MANAGEMENT_URL;
    process.env.STRAPI_MANAGEMENT_URL = "https://attacker.invalid";
    try {
      await writeFile(envPath, [
        "STRAPI_MANAGEMENT_URL=http://127.0.0.1:1337",
        "STRAPI_API_TOKEN=canonical-token",
        `STRAPI_REVALIDATE_SECRET=${revalidationSecret}`,
        "",
      ].join("\n"));
      await expect(loadEnvFile(envPath)).resolves.toMatchObject({
        STRAPI_MANAGEMENT_URL: "http://127.0.0.1:1337",
        STRAPI_API_TOKEN: "canonical-token",
        STRAPI_REVALIDATE_SECRET: revalidationSecret,
      });
      expect(process.env.STRAPI_MANAGEMENT_URL).toBe("https://attacker.invalid");
    } finally {
      if (inherited === undefined) delete process.env.STRAPI_MANAGEMENT_URL;
      else process.env.STRAPI_MANAGEMENT_URL = inherited;
      await rm(directory, { recursive: true, force: true });
    }
  });

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
      return new Response(JSON.stringify({
        error: { details: { code: "EDITORIAL_VERSION_CONFLICT" } },
      }), { status: 400, headers: { "content-type": "application/json" } });
    });

    await expect(runScheduledPublications({
      baseUrl: "https://cms.test",
      token: "scoped-token",
      actorEmail: "publisher@example.test",
      limit: 25,
      fetchImpl: fetchMock,
    })).resolves.toEqual({ considered: 1, published: 0, skipped: 1, failed: 0 });
  });

  it("fails a permanent content error instead of masking every 400 response", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/episodes") {
        return new Response(JSON.stringify({ data: [{ documentId: "episode-1", updatedAt: "old" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.pathname === "/api/pages" || url.pathname === "/api/posts") {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        error: {
          message: "sensitive content must not be logged",
          details: { code: "EDITORIAL_INVALID_TRACK_ID" },
        },
      }), { status: 400 });
    });

    await expect(runScheduledPublications({
      baseUrl: "https://cms.test",
      token: "secret-token-must-not-be-logged",
      actorEmail: "publisher@example.test",
      limit: 25,
      fetchImpl: fetchMock,
    })).resolves.toEqual({ considered: 1, published: 0, skipped: 0, failed: 1 });

    const log = logged.mock.calls.flat().join(" ");
    expect(log).toContain("EDITORIAL_INVALID_TRACK_ID");
    expect(log).toContain("episode-1");
    expect(log).not.toContain("sensitive content");
    expect(log).not.toContain("secret-token");
  });

  it("fails an unclassified 404 so a missing custom route cannot look healthy", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/pages") {
        return new Response(JSON.stringify({ data: [{ documentId: "page-1", updatedAt: "old" }] }), { status: 200 });
      }
      if (url.pathname === "/api/posts" || url.pathname === "/api/episodes") {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: "Not Found" } }), { status: 404 });
    });

    await expect(runScheduledPublications({
      baseUrl: "https://cms.test",
      token: "scoped-token",
      actorEmail: "publisher@example.test",
      limit: 25,
      fetchImpl: fetchMock,
    })).resolves.toEqual({ considered: 1, published: 0, skipped: 0, failed: 1 });
  });

  it("persists invalidation before publishing and clears it only after the exact loopback route confirms", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scheduled-invalidation-"));
    const markerPath = join(directory, "cache-revalidation-pending.json");
    const order: string[] = [];
    try {
      const fetchMock = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
        const url = new URL(String(input));
        if (String(input) === PUBLIC_CACHE_INVALIDATION_URL) {
          order.push("invalidate");
          expect(init.headers).toMatchObject({ Authorization: `Bearer ${revalidationSecret}` });
          expect(JSON.parse(String(init.body))).toEqual({
            event: "entry.publish",
            source: "scheduled-publication",
          });
          return new Response(JSON.stringify({ revalidated: true }), { status: 200 });
        }
        if (url.pathname === "/api/pages") {
          return new Response(JSON.stringify({
            data: [{ documentId: "page-1", updatedAt: "2026-07-22T11:59:00.000Z" }],
          }), { status: 200 });
        }
        if (url.pathname === "/api/posts" || url.pathname === "/api/episodes") {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        order.push("publish");
        await expect(readPendingPublicCacheInvalidation(markerPath)).resolves.toMatchObject({
          pending: true,
          source: "scheduled-publication",
        });
        return new Response(JSON.stringify({ data: { documentId: "page-1" } }), { status: 200 });
      });

      await expect(runScheduledPublicationCycle({
        baseUrl: "https://cms.test",
        token: "scoped-token",
        actorEmail: "publisher@example.test",
        revalidationSecret,
        invalidationMarkerPath: markerPath,
        fetchImpl: fetchMock,
      })).resolves.toEqual({ considered: 1, published: 1, skipped: 0, failed: 0 });

      expect(order).toEqual(["publish", "invalidate"]);
      await expect(readPendingPublicCacheInvalidation(markerPath)).resolves.toBeNull();
      expect(fetchMock.mock.calls.filter(([input]) => String(input) === PUBLIC_CACHE_INVALIDATION_URL)).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retains a marker and reports failure when invalidation is not confirmed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scheduled-invalidation-failure-"));
    const markerPath = join(directory, "cache-revalidation-pending.json");
    try {
      const fetchMock = vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        if (String(input) === PUBLIC_CACHE_INVALIDATION_URL) {
          return new Response(JSON.stringify({ revalidated: false }), { status: 503 });
        }
        if (url.pathname === "/api/pages") {
          return new Response(JSON.stringify({ data: [{ documentId: "page-1", updatedAt: "old" }] }), { status: 200 });
        }
        if (url.pathname === "/api/posts" || url.pathname === "/api/episodes") {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: { documentId: "page-1" } }), { status: 200 });
      });

      const result = runScheduledPublicationCycle({
        baseUrl: "https://cms.test",
        token: "scoped-token",
        actorEmail: "publisher@example.test",
        revalidationSecret,
        invalidationMarkerPath: markerPath,
        fetchImpl: fetchMock,
      });
      await expect(result).rejects.toThrow("Public cache invalidation was not confirmed (HTTP 503).");
      await expect(readPendingPublicCacheInvalidation(markerPath)).resolves.toMatchObject({ pending: true });
      await expect(result.catch((error: Error) => error.message)).resolves.not.toContain(revalidationSecret);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retries a durable marker before a zero-work run and blocks new work when that retry fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scheduled-invalidation-retry-"));
    const markerPath = join(directory, "cache-revalidation-pending.json");
    try {
      await markPublicCacheInvalidationPending(markerPath, "scheduled-publication");
      const successfulOrder: string[] = [];
      const successfulFetch = vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        if (String(input) === PUBLIC_CACHE_INVALIDATION_URL) {
          successfulOrder.push("invalidate");
          return new Response(JSON.stringify({ revalidated: true }), { status: 200 });
        }
        successfulOrder.push(url.pathname);
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      await expect(runScheduledPublicationCycle({
        baseUrl: "https://cms.test",
        token: "scoped-token",
        actorEmail: "publisher@example.test",
        revalidationSecret,
        invalidationMarkerPath: markerPath,
        fetchImpl: successfulFetch,
      })).resolves.toEqual({ considered: 0, published: 0, skipped: 0, failed: 0 });
      expect(successfulOrder[0]).toBe("invalidate");
      await expect(readPendingPublicCacheInvalidation(markerPath)).resolves.toBeNull();

      await markPublicCacheInvalidationPending(markerPath, "scheduled-publication");
      const failedFetch = vi.fn(async () => new Response(JSON.stringify({ revalidated: false }), { status: 500 }));
      await expect(runScheduledPublicationCycle({
        baseUrl: "https://cms.test",
        token: "scoped-token",
        actorEmail: "publisher@example.test",
        revalidationSecret,
        invalidationMarkerPath: markerPath,
        fetchImpl: failedFetch,
      })).rejects.toThrow("Public cache invalidation was not confirmed (HTTP 500).");
      expect(failedFetch).toHaveBeenCalledTimes(1);
      await expect(readPendingPublicCacheInvalidation(markerPath)).resolves.toMatchObject({ pending: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not delete a newer marker created while an invalidation request is in flight", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scheduled-invalidation-race-"));
    const markerPath = join(directory, "cache-revalidation-pending.json");
    try {
      await markPublicCacheInvalidationPending(markerPath, "scheduled-publication");
      let invalidations = 0;
      const fetchMock = vi.fn(async () => {
        invalidations += 1;
        if (invalidations === 1) {
          await markPublicCacheInvalidationPending(markerPath, "scheduled-publication");
        }
        return new Response(JSON.stringify({ revalidated: true }), { status: 200 });
      });

      await expect(flushPendingPublicCacheInvalidation({
        markerPath,
        secret: revalidationSecret,
        fetchImpl: fetchMock,
      })).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await expect(readPendingPublicCacheInvalidation(markerPath)).resolves.toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serializes concurrent flushers so only one processes an in-flight marker", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scheduled-invalidation-flushers-"));
    const markerPath = join(directory, "cache-revalidation-pending.json");
    let releaseFirstRequest: (() => void) | undefined;
    const firstRequestRelease = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve;
    });
    let firstRequestStarted: (() => void) | undefined;
    const firstRequestStart = new Promise<void>((resolve) => {
      firstRequestStarted = resolve;
    });
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    try {
      await markPublicCacheInvalidationPending(markerPath, "scheduled-publication");
      const fetchMock = vi.fn(async () => {
        activeRequests += 1;
        maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
        firstRequestStarted?.();
        await firstRequestRelease;
        activeRequests -= 1;
        return new Response(JSON.stringify({ revalidated: true }), { status: 200 });
      });

      const first = flushPendingPublicCacheInvalidation({
        markerPath,
        secret: revalidationSecret,
        fetchImpl: fetchMock,
      });
      await firstRequestStart;
      const second = flushPendingPublicCacheInvalidation({
        markerPath,
        secret: revalidationSecret,
        fetchImpl: fetchMock,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      releaseFirstRequest?.();

      await expect(Promise.all([first, second])).resolves.toEqual([true, false]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(maximumActiveRequests).toBe(1);
      await expect(readPendingPublicCacheInvalidation(markerPath)).resolves.toBeNull();
    } finally {
      releaseFirstRequest?.();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("recovers an atomically claimed marker after a process crash and rejects symlink markers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scheduled-invalidation-claim-"));
    const markerPath = join(directory, "cache-revalidation-pending.json");
    try {
      await markPublicCacheInvalidationPending(markerPath, "scheduled-publication");
      await rename(markerPath, `${markerPath}.inflight`);
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ revalidated: true }), { status: 200 }));

      await expect(flushPendingPublicCacheInvalidation({
        markerPath,
        secret: revalidationSecret,
        fetchImpl: fetchMock,
      })).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(readPendingPublicCacheInvalidation(markerPath)).resolves.toBeNull();

      const target = join(directory, "target.json");
      await symlink(target, markerPath);
      await expect(markPublicCacheInvalidationPending(markerPath, "scheduled-publication"))
        .rejects.toThrow("not a regular file");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
