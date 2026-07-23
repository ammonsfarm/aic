import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const mocks = vi.hoisted(() => ({
  queryRows: vi.fn(),
  requireContentManagerApiUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ queryRows: mocks.queryRows }));
vi.mock("@/lib/rbac", () => ({
  isForbiddenError: () => false,
  requireContentManagerApiUser: mocks.requireContentManagerApiUser,
}));

import {
  capturePublicSubscription,
  readSubscriptionJson,
  subscriptionUnsubscribeToken,
  subscriptionUnsubscribeTokenHash,
  SubscriptionBodyTooLargeError,
  unsubscribePublicSubscription,
  validateSubscriptionPayload,
  verifySubscriptionUnsubscribeToken,
} from "@/lib/public-subscriptions";
import {
  SUBSCRIPTION_ATTEMPT_RETENTION_DAYS,
  SUBSCRIPTION_CONSENT_VERSION,
} from "@/lib/public-subscription-contract";
import { POST as subscribe } from "@/app/api/public/subscriptions/route";
import {
  missingSubscriptionProviderConfig,
  subscriptionProviderConfigReady,
} from "@/lib/subscription-provider-config";
import { GET as exportSubscriptions } from "@/app/api/admin/subscriptions/export/route";
import {
  applyMailchimpWebhook,
  mailchimpWebhookEventKey,
  parseMailchimpWebhook,
  verifyMailchimpWebhookSignature,
} from "@/lib/mailchimp-subscriptions";

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
  beforeEach(() => {
    mocks.queryRows.mockReset();
    mocks.requireContentManagerApiUser.mockReset().mockResolvedValue({ email: "editor@example.com" });
    process.env.SUBSCRIPTION_RATE_LIMIT_SECRET = "test-only-rate-secret";
    process.env.SUBSCRIPTION_UNSUBSCRIBE_SECRET = "test-only-unsubscribe-secret";
    process.env.MAILCHIMP_API_KEY = "test-only-api-key-us21";
    process.env.MAILCHIMP_SERVER_PREFIX = "us21";
    process.env.MAILCHIMP_AUDIENCE_ID = "9ad7bbba36";
    process.env.MAILCHIMP_WEBHOOK_SECRET = "test-only-mailchimp-webhook-secret";
  });

  it("fails closed for malformed Mailchimp routing values before accepting a signup", async () => {
    expect(subscriptionProviderConfigReady()).toBe(true);

    process.env.MAILCHIMP_SERVER_PREFIX = "evil.example.com/path";
    expect(subscriptionProviderConfigReady()).toBe(false);
    expect(missingSubscriptionProviderConfig()).toContain("MAILCHIMP_SERVER_PREFIX");

    const response = await subscribe(new Request("https://www.pastorwood.org/api/public/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://www.pastorwood.org" },
      body: JSON.stringify(validPayload(Date.now())),
    }));
    expect(response.status).toBe(503);
    expect(mocks.queryRows).not.toHaveBeenCalled();

    process.env.MAILCHIMP_SERVER_PREFIX = "us21";
    process.env.MAILCHIMP_AUDIENCE_ID = "not-an-audience";
    expect(subscriptionProviderConfigReady()).toBe(false);
    expect(missingSubscriptionProviderConfig()).toContain("MAILCHIMP_AUDIENCE_ID");
  });

  it("uses opaque tamper-evident signed unsubscribe tokens", () => {
    process.env.SUBSCRIPTION_UNSUBSCRIBE_SECRET = "test-only-unsubscribe-secret";
    const token = subscriptionUnsubscribeToken("Listener@Example.com");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain(Buffer.from("listener@example.com").toString("base64url"));
    expect(verifySubscriptionUnsubscribeToken(token)).toBe(token);
    expect(subscriptionUnsubscribeTokenHash(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(verifySubscriptionUnsubscribeToken(`${token.slice(0, -1)}x`)).toBeNull();
    expect(verifySubscriptionUnsubscribeToken("javascript:alert(1)")).toBeNull();
  });

  it("looks up unsubscribe requests by an opaque token hash instead of email", async () => {
    process.env.SUBSCRIPTION_UNSUBSCRIBE_SECRET = "test-only-unsubscribe-secret";
    const token = subscriptionUnsubscribeToken("Listener@Example.com");
    mocks.queryRows.mockResolvedValueOnce([{ subscription_id: "42" }]);

    await expect(unsubscribePublicSubscription(token)).resolves.toEqual({ ok: true });
    const [sql, values] = mocks.queryRows.mock.calls[0] as [string, string[]];
    expect(sql).toContain("where unsubscribe_token_hash = $1");
    expect(sql).toContain("select subscription_id::text from recorded_event");
    expect(sql).toContain("public_subscription_provider_outbox");
    expect(sql).toContain("desired_action = 'unsubscribe'");
    expect(values).toEqual([subscriptionUnsubscribeTokenHash(token)]);
    expect(JSON.stringify(values)).not.toContain("listener@example.com");
    expect(JSON.stringify(values)).not.toContain(token);
  });

  it("persists matching opaque-token hashes before exporting unsubscribe URLs", async () => {
    process.env.PASTORWOOD_PUBLIC_URL = "https://www.pastorwood.org";
    process.env.SUBSCRIPTION_UNSUBSCRIBE_SECRET = "test-only-unsubscribe-secret";
    mocks.queryRows
      .mockResolvedValueOnce([{
        email: "listener@example.com",
        status: "active",
        consent_version: SUBSCRIPTION_CONSENT_VERSION,
        consent_at: "2026-07-22T12:00:00.000Z",
        source_path: "/",
        created_at: "2026-07-22T12:00:00.000Z",
        updated_at: "2026-07-22T12:00:00.000Z",
        provider_status: "subscribed",
        provider_synced_at: "2026-07-22T12:00:00.000Z",
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await exportSubscriptions(new Request("https://aic.ammonsfarm.org/api/admin/subscriptions/export"));
    expect(response.status).toBe(200);
    const [, backfillValues] = mocks.queryRows.mock.calls[1] as [string, string[]];
    const supplied = JSON.parse(backfillValues[0]) as Array<Record<string, string>>;
    expect(supplied).toEqual([{
      email: "listener@example.com",
      token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }]);
    expect(String(mocks.queryRows.mock.calls[1]?.[0])).toContain("supplied.token_hash");

    const csv = await response.text();
    const url = csv.match(/https:\/\/www\.pastorwood\.org\/unsubscribe\?token=([A-Za-z0-9_.~-]+)/)?.[0];
    expect(url).toBeTruthy();
    expect(url).not.toContain(Buffer.from("listener@example.com").toString("base64url"));
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
    expect(outcomeSql).toContain("select event_type from recorded_event");
    expect(outcomeSql).toContain("source_path, ip_hash, user_agent_hash, unsubscribe_token_hash");
    expect(outcomeSql).toContain("provider_status, provider_last_error, updated_at");
    expect(outcomeSql).toContain("values ($1, 'pending', $2, $3, now(), $4, $5, $6, $7, 'pending', null, now())");
    expect(outcomeSql).toContain("unsubscribe_token_hash = excluded.unsubscribe_token_hash");
    expect(outcomeSql).toContain("public_subscription_provider_outbox");
    expect(outcomeSql).toContain("desired_action = 'subscribe'");
    expect(mocks.queryRows.mock.calls[2]?.[1]?.[6]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns pending confirmation instead of claiming immediate subscription", async () => {
    const now = Date.now();
    mocks.queryRows
      .mockResolvedValueOnce([{ ip_count: "0", email_count: "0", cleaned_count: "0" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ event_type: "consent-captured" }]);

    const response = await subscribe(new Request("https://www.pastorwood.org/api/public/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://www.pastorwood.org" },
      body: JSON.stringify(validPayload(now)),
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      state: "pending",
      message: "Check your email to confirm your weekly devotional subscription.",
    });
  });

  it("verifies exact-body Mailchimp signatures and rejects stale deliveries", () => {
    const raw = new TextEncoder().encode(JSON.stringify({ type: "subscribe", data: { list_id: "9ad7bbba36" } }));
    const timestamp = 1_718_000_000;
    const signature = createHmac("sha256", process.env.MAILCHIMP_WEBHOOK_SECRET!)
      .update(`${timestamp}.`)
      .update(raw)
      .digest("hex");
    expect(() => verifyMailchimpWebhookSignature(raw, `t=${timestamp},v1=${signature}`, timestamp)).not.toThrow();
    expect(() => verifyMailchimpWebhookSignature(raw, `t=${timestamp},v1=${signature}`, timestamp + 301)).toThrow(/outside/);
    expect(() => verifyMailchimpWebhookSignature(new TextEncoder().encode("changed"), `t=${timestamp},v1=${signature}`, timestamp)).toThrow(/verified/);
  });

  it("parses both signed webhook encodings and rejects another audience", () => {
    const json = new TextEncoder().encode(JSON.stringify({
      type: "subscribe",
      fired_at: "2026-07-22T12:00:00Z",
      data: { list_id: "9ad7bbba36", email: "Listener@Example.com", id: "member_1" },
    }));
    expect(parseMailchimpWebhook(json, "application/json")).toEqual({
      type: "subscribe",
      firedAt: "2026-07-22T12:00:00Z",
      audienceId: "9ad7bbba36",
      email: "listener@example.com",
      memberId: "member_1",
    });

    const form = new TextEncoder().encode(new URLSearchParams({
      type: "unsubscribe",
      fired_at: "2026-07-22 12:00:00",
      "data[list_id]": "9ad7bbba36",
      "data[email]": "listener@example.com",
      "data[id]": "member_1",
    }).toString());
    expect(parseMailchimpWebhook(form, "application/x-www-form-urlencoded").type).toBe("unsubscribe");

    const wrongAudience = new TextEncoder().encode(JSON.stringify({
      type: "subscribe",
      data: { list_id: "aaaaaaaaaa", email: "listener@example.com", id: "member_1" },
    }));
    expect(() => parseMailchimpWebhook(wrongAudience, "application/json")).toThrow(/audience/);
  });

  it("deduplicates provider events and preserves local suppression", async () => {
    const event = {
      type: "subscribe" as const,
      firedAt: "2026-07-22T12:00:00Z",
      audienceId: "9ad7bbba36",
      email: "listener@example.com",
      memberId: "member_1",
    };
    mocks.queryRows.mockResolvedValueOnce([{ subscription_id: "42" }]);
    await expect(applyMailchimpWebhook(event)).resolves.toEqual({ applied: true });
    const [sql, values] = mocks.queryRows.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("public_subscription_provider_webhook_events");
    expect(sql).toContain("on conflict (event_key) do nothing");
    expect(sql).toContain("when public_subscriptions.status = 'suppressed' then 'suppressed'");
    expect(sql).toContain("where status = 'suppressed' and $2 = 'subscribe'");
    expect(values[0]).toBe(mailchimpWebhookEventKey(event));
    expect(JSON.stringify(values)).not.toContain(process.env.MAILCHIMP_WEBHOOK_SECRET);
  });
});
