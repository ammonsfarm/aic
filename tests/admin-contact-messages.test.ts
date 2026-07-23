import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRows: vi.fn(),
  requireContentManagerApiUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ queryRows: mocks.queryRows }));
vi.mock("@/lib/rbac", () => ({
  isForbiddenError: (error: unknown) => error instanceof Error && error.name === "ForbiddenError",
  requireContentManagerApiUser: mocks.requireContentManagerApiUser,
}));

import { GET as exportMessages } from "@/app/api/admin/contact-messages/export/route";
import { POST as updateStatus } from "@/app/api/admin/contact-messages/status/route";
import {
  getContactMessage,
  listContactMessages,
  parseContactInboxFilter,
} from "@/lib/contact-messages";

const publicId = "6c73d469-4d19-4bc2-a2fa-1f6f0a4f7b50";
const createdAt = "2026-07-22T14:00:00.000Z";

function row(overrides: Record<string, unknown> = {}) {
  return {
    public_id: publicId,
    category: "prayer",
    name: "=Jane Listener",
    email: "jane@example.org",
    phone: "",
    organization: "",
    subject: "+Prayer request",
    message: "Please pray for our family during a difficult week.",
    status: "new",
    status_updated_by: "",
    consent_version: "2026-07-22",
    consent_text: "I consent.",
    consent_at: createdAt,
    source_path: "/contact/",
    notification_status: "not_configured",
    notification_detail: "No notification provider is configured.",
    notified_at: "",
    created_at: createdAt,
    updated_at: createdAt,
    resolved_at: "",
    ...overrides,
  };
}

describe("protected contact-message controls", () => {
  beforeEach(() => {
    mocks.queryRows.mockReset();
    mocks.requireContentManagerApiUser.mockReset().mockResolvedValue({
      clerkUserId: "user-1",
      email: "editor@example.org",
      name: "Editor",
      role: "Content Manager",
    });
  });

  it("parses bounded filters and returns a paginated list without request fingerprints", async () => {
    const filter = parseContactInboxFilter({ status: "new", category: "prayer", q: "family", page: "2" });
    mocks.queryRows
      .mockResolvedValueOnce([{ total: "26" }])
      .mockResolvedValueOnce([row()]);
    const result = await listContactMessages(filter);
    expect(result).toMatchObject({ total: 26, totalPages: 2, messages: [{ publicId, status: "new" }] });
    const sql = mocks.queryRows.mock.calls.map((call) => String(call[0])).join("\n");
    expect(sql).not.toMatch(/select[^;]*(?:ip_hash|user_agent_hash)/i);
    expect(mocks.queryRows.mock.calls[1]?.[1]).toEqual(["new", "prayer", "family", 25, 25]);
  });

  it("loads detail and attributed event history by opaque public id", async () => {
    mocks.queryRows
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([{
        id: "1",
        event_type: "received",
        actor_type: "public_form",
        actor_email: null,
        note: null,
        metadata: { sourcePath: "/contact/" },
        created_at: createdAt,
      }]);
    const result = await getContactMessage(publicId);
    expect(result).toMatchObject({
      message: { publicId, notificationStatus: "not_configured" },
      events: [{ eventType: "received", actorType: "public_form" }],
    });
    expect(mocks.queryRows.mock.calls[0]?.[1]).toEqual([publicId]);
  });

  it("updates status with optimistic concurrency, an event, and the shared audit log", async () => {
    mocks.queryRows.mockResolvedValueOnce([{ public_id: publicId, updated_at: "2026-07-22T15:00:00.000Z" }]);
    const response = await updateStatus(new Request("https://aic.ammonsfarm.org/api/admin/contact-messages/status", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://aic.ammonsfarm.org" },
      body: JSON.stringify({
        publicId,
        status: "in_review",
        expectedUpdatedAt: createdAt,
        note: "Assigned to ministry office.",
      }),
    }));
    expect(response.status).toBe(200);
    const [sql, values] = mocks.queryRows.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("public_contact_message_events");
    expect(sql).toContain("content_audit_log");
    expect(sql).toContain("updated_at = $3::timestamptz");
    expect(values).toEqual([publicId, "in_review", createdAt, "editor@example.org", "Assigned to ministry office."]);
  });

  it("exports authorized records safely without IP or browser hashes and audits the export", async () => {
    mocks.queryRows
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([]);
    const response = await exportMessages(new Request("https://aic.ammonsfarm.org/api/admin/contact-messages/export?status=new&category=prayer"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toMatch(/attachment/);
    const csv = await response.text();
    expect(csv).toContain("'=Jane Listener");
    expect(csv).toContain("'+Prayer request");
    expect(csv).not.toMatch(/ip_hash|user_agent_hash|203\.0\.113/);
    expect(String(mocks.queryRows.mock.calls[1]?.[0])).toContain("content_audit_log");
  });

  it("returns role-aware 403 responses before reading protected data", async () => {
    const forbidden = new Error("forbidden");
    forbidden.name = "ForbiddenError";
    mocks.requireContentManagerApiUser.mockRejectedValueOnce(forbidden);
    const response = await exportMessages(new Request("https://aic.ammonsfarm.org/api/admin/contact-messages/export"));
    expect(response.status).toBe(403);
    expect(mocks.queryRows).not.toHaveBeenCalled();
  });
});
