import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchStrapiJsonOrNull } from "@/lib/strapi-request";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Strapi outage fallback", () => {
  it("returns null for a connection failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("connection refused")));

    await expect(
      fetchStrapiJsonOrNull("http://strapi.invalid/api/pages", {}, { label: "test" }),
    ).resolves.toBeNull();
  });

  it("returns null for an HTTP failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("down", { status: 503 })),
    );

    await expect(
      fetchStrapiJsonOrNull("http://strapi.invalid/api/pages", {}, { label: "test" }),
    ).resolves.toBeNull();
  });

  it("returns null when Strapi returns malformed JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }),
      ),
    );

    await expect(
      fetchStrapiJsonOrNull("http://strapi.invalid/api/pages", {}, { label: "test" }),
    ).resolves.toBeNull();
  });

  it("aborts a fetch that exceeds the configured bound", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
      ),
    );

    const startedAt = Date.now();
    await expect(
      fetchStrapiJsonOrNull(
        "http://strapi.invalid/api/pages",
        {},
        { label: "test", timeoutMs: 10 },
      ),
    ).resolves.toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
