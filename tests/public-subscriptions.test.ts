import { describe, expect, it } from "vitest";

import {
  readSubscriptionJson,
  subscriptionUnsubscribeToken,
  SubscriptionBodyTooLargeError,
  validateSubscriptionPayload,
  verifySubscriptionUnsubscribeToken,
} from "@/lib/public-subscriptions";
import { SUBSCRIPTION_CONSENT_VERSION } from "@/lib/public-subscription-contract";

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
});
