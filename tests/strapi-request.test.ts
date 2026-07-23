import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchStrapiJsonOrNull,
  fetchStrapiJsonResult,
  publicStrapiCircuitCooldownMs,
  publicStrapiFetchTimeoutMs,
  resetPublicStrapiCircuitForTests,
} from "@/lib/strapi-request";

function publicRequest() {
  return fetchStrapiJsonResult<{ data?: unknown }>(
    "https://strapi.example.test/api/pages",
    {},
    { label: "public test", publicRequest: true },
  );
}

function deferredResponse() {
  let resolve: ((response: Response) => void) | undefined;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve: (response: Response) => resolve?.(response) };
}

beforeEach(() => {
  resetPublicStrapiCircuitForTests();
});

afterEach(() => {
  vi.useRealTimers();
  resetPublicStrapiCircuitForTests();
  delete process.env.STRAPI_PUBLIC_FETCH_TIMEOUT_MS;
  delete process.env.STRAPI_PUBLIC_CIRCUIT_COOLDOWN_MS;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

describe("public Strapi circuit", () => {
  it.each([
    ["network rejection", () => Promise.reject(new TypeError("connection refused"))],
    ["HTTP 5xx", () => Promise.resolve(new Response("down", { status: 503 }))],
    ["invalid JSON", () => Promise.resolve(new Response("not-json", { status: 200 }))],
  ])("trips after a %s", async (_label, failure) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockImplementationOnce(failure)
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(publicRequest()).resolves.toEqual({ status: "unavailable" });
    await expect(publicRequest()).resolves.toEqual({ status: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not trip for an HTTP 4xx response", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(publicRequest()).resolves.toEqual({ status: "unavailable" });
    await expect(publicRequest()).resolves.toEqual({ status: "ok", data: { data: [] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the circuit open when a stale concurrent success finishes after a failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failed = deferredResponse();
    const staleSuccess = deferredResponse();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(failed.promise)
      .mockReturnValueOnce(staleSuccess.promise);
    vi.stubGlobal("fetch", fetchMock);

    const failureRequest = publicRequest();
    const successRequest = publicRequest();
    failed.resolve(new Response("down", { status: 503 }));
    await expect(failureRequest).resolves.toEqual({ status: "unavailable" });
    staleSuccess.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await expect(successRequest).resolves.toEqual({ status: "ok", data: { data: [] } });

    await expect(publicRequest()).resolves.toEqual({ status: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the circuit open when a concurrent failure finishes after an earlier success", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const success = deferredResponse();
    const lateFailure = deferredResponse();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(success.promise)
      .mockReturnValueOnce(lateFailure.promise);
    vi.stubGlobal("fetch", fetchMock);

    const successRequest = publicRequest();
    const failureRequest = publicRequest();
    success.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await expect(successRequest).resolves.toEqual({ status: "ok", data: { data: [] } });
    lateFailure.resolve(new Response("down", { status: 503 }));
    await expect(failureRequest).resolves.toEqual({ status: "unavailable" });

    await expect(publicRequest()).resolves.toEqual({ status: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows exactly one half-open probe and closes after its authoritative 200-empty response", async () => {
    process.env.STRAPI_PUBLIC_CIRCUIT_COOLDOWN_MS = "25";
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const recovery = deferredResponse();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockReturnValueOnce(recovery.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(publicRequest()).resolves.toEqual({ status: "unavailable" });
    now.mockReturnValue(1_025);
    const probe = publicRequest();
    await expect(publicRequest()).resolves.toEqual({ status: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    recovery.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await expect(probe).resolves.toEqual({ status: "ok", data: { data: [] } });
    await expect(publicRequest()).resolves.toEqual({ status: "ok", data: { data: [] } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("bounds the first failure by the public timeout and resolves suppressed requests without advancing time", async () => {
    vi.useFakeTimers();
    process.env.STRAPI_PUBLIC_FETCH_TIMEOUT_MS = "25";
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    let firstSettled = false;
    const first = publicRequest().finally(() => {
      firstSettled = true;
    });
    await vi.advanceTimersByTimeAsync(24);
    expect(firstSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(first).resolves.toEqual({ status: "unavailable" });

    let suppressedSettled = false;
    const suppressed = publicRequest().finally(() => {
      suppressedSettled = true;
    });
    await Promise.resolve();
    await expect(suppressed).resolves.toEqual({ status: "unavailable" });
    expect(suppressedSettled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the same public deadline when headers arrive but the response body hangs", async () => {
    vi.useFakeTimers();
    process.env.STRAPI_PUBLIC_FETCH_TIMEOUT_MS = "25";
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const response = new Response(null, { status: 200 });
      response.text = () => new Promise<string>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
      return Promise.resolve(response);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    let settled = false;
    const request = publicRequest().finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(24);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toEqual({ status: "unavailable" });

    await expect(publicRequest()).resolves.toEqual({ status: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clamps public timeout and cooldown configuration to their safety bounds", () => {
    process.env.STRAPI_PUBLIC_FETCH_TIMEOUT_MS = "999999";
    process.env.STRAPI_PUBLIC_CIRCUIT_COOLDOWN_MS = "999999";
    expect(publicStrapiFetchTimeoutMs()).toBe(4_000);
    expect(publicStrapiCircuitCooldownMs()).toBe(5 * 60_000);

    process.env.STRAPI_PUBLIC_FETCH_TIMEOUT_MS = "0";
    process.env.STRAPI_PUBLIC_CIRCUIT_COOLDOWN_MS = "not-a-number";
    expect(publicStrapiFetchTimeoutMs()).toBe(1_500);
    expect(publicStrapiCircuitCooldownMs()).toBe(30_000);
  });
});
