import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRows: vi.fn() }));

vi.mock("@/lib/db", () => ({ queryRows: mocks.queryRows }));

import { POST as submitContact } from "@/app/api/public/contact/route";
import {
  capturePublicContactMessage,
  ContactBodyTooLargeError,
  readContactJson,
  validatePublicContactPayload,
} from "@/lib/public-contact";
import { CONTACT_CONSENT_VERSION } from "@/lib/public-contact-contract";

function validPayload(now = Date.now()) {
  return {
    category: "speaking",
    name: "Jane Listener",
    email: "Jane@Example.org",
    phone: "+1 (865) 555-0100",
    organization: "Mountain Conference",
    subject: "Speaking invitation",
    message: "Would Pastor Wood be available to speak at our conference?",
    consent: true,
    consentVersion: CONTACT_CONSENT_VERSION,
    sourcePath: "/contact/",
    website: "",
    startedAt: now,
  };
}

function contactRequest(payload: unknown, headers: Record<string, string> = {}) {
  return new Request("https://www.pastorwood.org/api/public/contact", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://www.pastorwood.org",
      "user-agent": "contact-test-agent",
      "cf-connecting-ip": "203.0.113.10",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

describe("public contact boundary", () => {
  beforeEach(() => {
    process.env.CONTACT_RATE_LIMIT_SECRET = "test-only-contact-secret";
    mocks.queryRows.mockReset();
  });

  it("strictly validates useful contact fields and explicit consent", () => {
    const now = Date.now();
    const valid = validatePublicContactPayload(validPayload(now), now);
    expect(valid).toMatchObject({ ok: true, value: { email: "jane@example.org", category: "speaking" } });
    expect(validatePublicContactPayload({ ...validPayload(now), category: "billing" }, now)).toMatchObject({ ok: false, bot: false });
    expect(validatePublicContactPayload({ ...validPayload(now), consent: false }, now)).toMatchObject({ ok: false, bot: false });
    expect(validatePublicContactPayload({ ...validPayload(now), unknown: "field" }, now)).toMatchObject({ ok: false, bot: false });
    expect(validatePublicContactPayload({ ...validPayload(now), website: "spam.example" }, now)).toMatchObject({ ok: false, bot: true });
  });

  it("bounds streamed bodies even without a content-length header", async () => {
    const request = new Request("https://www.pastorwood.org/api/public/contact", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`{"message":"${"a".repeat(20_000)}"}`));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(readContactJson(request)).rejects.toBeInstanceOf(ContactBodyTooLargeError);
  });

  it("stores only keyed request hashes while preserving the submitted correspondence", async () => {
    const now = Date.now();
    const validation = validatePublicContactPayload(validPayload(now), now);
    if (!validation.ok) throw new Error("Expected valid fixture.");
    mocks.queryRows
      .mockResolvedValueOnce([{ accepted: true }])
      .mockImplementationOnce(async (_sql: string, values: unknown[]) => [{ public_id: values[0] }]);

    const result = await capturePublicContactMessage(validation.value, contactRequest(validPayload(now)));
    expect(result).toMatchObject({ ok: true, messageId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    const allValues = JSON.stringify(mocks.queryRows.mock.calls.map((call) => call[1]));
    expect(allValues).not.toContain("203.0.113.10");
    expect(allValues).not.toContain("contact-test-agent");
    const insertValues = mocks.queryRows.mock.calls[1]?.[1] as unknown[];
    expect(insertValues[3]).toBe("jane@example.org");
    expect(insertValues[11]).toMatch(/^[a-f0-9]{64}$/);
    expect(insertValues[12]).toMatch(/^[a-f0-9]{64}$/);
    expect(String(mocks.queryRows.mock.calls[1]?.[0])).toContain("'not_configured'");
    expect(String(mocks.queryRows.mock.calls[0]?.[0])).toContain("status = 'archived'");
    expect(String(mocks.queryRows.mock.calls[0]?.[0])).toContain("pg_advisory_xact_lock");
  });

  it("returns a generic honeypot success without touching storage", async () => {
    const response = await submitContact(contactRequest({ ...validPayload(), website: "spam.example" }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, message: "Thank you." });
    expect(mocks.queryRows).not.toHaveBeenCalled();
  });

  it("rejects cross-site and non-JSON requests before reading content", async () => {
    const crossSite = await submitContact(contactRequest(validPayload(), { origin: "https://evil.example" }));
    expect(crossSite.status).toBe(403);
    const wrongMedia = await submitContact(contactRequest(validPayload(), { "content-type": "text/plain" }));
    expect(wrongMedia.status).toBe(415);
    expect(mocks.queryRows).not.toHaveBeenCalled();
  });

  it("returns 429 for hashed rate limits and 503 when durable storage is unavailable", async () => {
    mocks.queryRows
      .mockResolvedValueOnce([{ accepted: false }]);
    const limited = await submitContact(contactRequest(validPayload()));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("3600");

    mocks.queryRows.mockReset().mockRejectedValueOnce(new Error("database unavailable"));
    const unavailable = await submitContact(contactRequest(validPayload()));
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
    expect(await unavailable.json()).toEqual({
      error: "The contact form is temporarily unavailable. Please call or email the ministry office instead.",
    });
  });
});
