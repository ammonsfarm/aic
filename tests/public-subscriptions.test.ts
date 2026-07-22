import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRows: vi.fn() }));

vi.mock("@/lib/db", () => ({ queryRows: mocks.queryRows }));

import {
  capturePublicSubscription,
  readSubscriptionJson,
  subscriptionUnsubscribeToken,
  SubscriptionBodyTooLargeError,
  validateSubscriptionPayload,
  verifySubscriptionUnsubscribeToken,
} from "@/lib/public-subscriptions";
import {
  SUBSCRIPTION_ATTEMPT_RETENTION_DAYS,
  SUBSCRIPTION_CONSENT_VERSION,
} from "@/lib/public-subscription-contract";
import { POST as subscribe } from "@/app/api/public/subscriptions/route";

function validPayload(startedAt: number) {
  return {
    email: "Listener@Example.com",
    consent: true,
    consentVersion: SUBSCRIPTION_CONSENT_VERSION,
    sourcePath: "/bible-study/",
    website: "",
    startedAt,
  };
}

describe("public subscription boundary", () => {
  beforeEach(() => mocks.queryRows.mockReset());

  it("uses tamper-evident signed unsubscribe tokens", () => {
    process.env.SUBSCRIPTION_UNSUBSCRIBE_SECRET = "test-only-unsubscribe-secret";
    const token = subscriptionUnsubscribeToken("Listener@Example.com");
    expect(verifySubscriptionUnsubscribeToken(token)).toBe("listener@example.com");
    expect(verifySubscriptionUnsubscribeToken(`${token.slice(0, -1)}x`)).toBeNull();
    expect(verifySubscriptionUnsubscribeToken("javascript:alert(1)")).toBeNull();
  });

  it("accepts a legitimate immediate autofill submission", () => {
    const now = Date.now();
    const result = validateSubscriptionPayload(validPayload(now), now);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.email).toBe("listener@example.com");
  });

  it("reserves bot classification for the honeypot", () => {
    const now = Date.now();
    expect(validateSubscriptionPayload({ ...validPayload(now), website: "spam" }, now)).toMatchObject({ ok: false, bot: true });
    expect(validateSubscriptionPayload(validPayload(now - 90_000_000), now)).toMatchObject({ ok: false, bot: false });
  });

  it("bounds streamed bodies even without content-length", async () => {
    const request = new Request("https://www.pastorwood.org/api/public/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`{"email":"${"a".repeat(12_000)}"}`));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readSubscriptionJson(request)).rejects.toBeInstanceOf(SubscriptionBodyTooLargeError);
  });

  it("prunes only a bounded batch past the documented retention window", async () => {
    const now = Date.now();
    const validation = validateSubscriptionPayload(validPayload(now), now);
    if (!validation.ok) throw new Error("Expected a valid subscription fixture.");
    mocks.queryRows
      .mockResolvedValueOnce([{ ip_count: "0", email_count: "0", cleaned_count: "12" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ event_type: "consent-captured" }]);

    const result = await capturePublicSubscription(
      validation.value,
      new Request("https://www.pastorwood.org/api/public/subscriptions", {
        headers: { "user-agent": "subscription-test" },
      }),
    );

    expect(result).toEqual({ ok: true });
    const [cleanupSql, cleanupValues] = mocks.queryRows.mock.calls[0] as [string, unknown[]];
    expect(cleanupSql).toContain("delete from public_subscription_attempts attempts");
    expect(cleanupSql).toContain("make_interval(days => $3::integer)");
    expect(cleanupSql).toContain("limit $4::integer");
    expect(cleanupValues.slice(2)).toEqual([SUBSCRIPTION_ATTEMPT_RETENTION_DAYS, 500]);
  });

  it("keeps a suppressed address suppressed and returns a generic non-success response", async () => {
    const now = Date.now();
    mocks.queryRows
      .mockResolvedValueOnce([{ ip_count: "0", email_count: "0", cleaned_count: "0" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ event_type: "resubscribe-blocked-suppressed" }]);

    const response = await subscribe(new Request("https://www.pastorwood.org/api/public/subscriptions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://www.pastorwood.org",
      },
      body: JSON.stringify(validPayload(now)),
    }));

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json();
    expect(payload).toEqual({
      error: "This subscription request could not be completed. Please contact us if you need help.",
    });
    expect(JSON.stringify(payload)).not.toMatch(/listener|example\.com|suppress|consent|status/i);

    const outcomeSql = String(mocks.queryRows.mock.calls[2]?.[0]);
    expect(outcomeSql).toContain("public_subscriptions.status = 'suppressed' then 'suppressed'");
    expect(outcomeSql).toContain("resubscribe-blocked-suppressed");
    expect(outcomeSql).toContain("returning event_type");
  });
});
