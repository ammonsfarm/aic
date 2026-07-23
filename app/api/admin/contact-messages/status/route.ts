import { NextResponse } from "next/server";

import { isContactMessagePublicId, updateContactMessageStatus } from "@/lib/contact-messages";
import { isSameSiteContactRequest, readContactJson, ContactBodyTooLargeError } from "@/lib/public-contact";
import { CONTACT_MESSAGE_STATUSES, type ContactMessageStatus } from "@/lib/public-contact-contract";
import { isForbiddenError, requireContentManagerApiUser } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await requireContentManagerApiUser();
    if (!isSameSiteContactRequest(request)) {
      return NextResponse.json({ error: "Cross-site requests are not accepted." }, { status: 403 });
    }
    if ((request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
    }
    let payload: unknown;
    try {
      payload = await readContactJson(request, 2_000);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof ContactBodyTooLargeError ? "Request is too large." : "Request body must be valid JSON." },
        { status: error instanceof ContactBodyTooLargeError ? 413 : 400 },
      );
    }
    const record = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    const publicId = typeof record.publicId === "string" ? record.publicId.trim() : "";
    const status = typeof record.status === "string" ? record.status.trim() as ContactMessageStatus : "" as ContactMessageStatus;
    const expectedUpdatedAt = typeof record.expectedUpdatedAt === "string" ? record.expectedUpdatedAt.trim() : "";
    const note = typeof record.note === "string" ? record.note.trim() : "";
    if (!isContactMessagePublicId(publicId) || !CONTACT_MESSAGE_STATUSES.includes(status) || !expectedUpdatedAt || note.length > 500) {
      return NextResponse.json({ error: "A valid message, status, and revision timestamp are required." }, { status: 400 });
    }
    const result = await updateContactMessageStatus({ publicId, status, expectedUpdatedAt, note, actor });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason === "not-found" ? "Contact message not found." : "This message changed after the page was loaded. Refresh and try again." },
        { status: result.reason === "not-found" ? 404 : 409, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return NextResponse.json(
      { ok: true, message: "Message status updated and audited." },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Content Manager role is required." }, { status: 403 });
    }
    console.error("Contact-message status update failed.", error);
    return NextResponse.json(
      { error: "The contact inbox is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "300" } },
    );
  }
}
