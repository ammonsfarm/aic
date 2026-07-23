import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { GET as exportSubscriptions } from "@/app/api/admin/subscriptions/export/route";

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
    expect(sql).toContain("returning subscription_id::text");
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
    expect(outcomeSql).toContain("returning event_type");
    expect(outcomeSql).toContain("source_path, ip_hash, user_agent_hash, unsubscribe_token_hash, updated_at");
    expect(outcomeSql).toContain("values ($1, 'active', $2, $3, now(), $4, $5, $6, $7, now())");
    expect(outcomeSql).toContain("unsubscribe_token_hash = excluded.unsubscribe_token_hash");
    expect(mocks.queryRows.mock.calls[2]?.[1]?.[6]).toMatch(/^[a-f0-9]{64}$/);
  });
});
