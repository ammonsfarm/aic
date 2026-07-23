import { NextResponse } from "next/server";

import { listContactMessagesForExport } from "@/lib/contact-messages";
import { queryRows } from "@/lib/db";
import { rowsToCsv } from "@/lib/podcast-reporting";
import {
  CONTACT_CATEGORIES,
  CONTACT_MESSAGE_STATUSES,
  type ContactCategory,
  type ContactMessageStatus,
} from "@/lib/public-contact-contract";
import { isForbiddenError, requireContentManagerApiUser } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireContentManagerApiUser();
    const params = new URL(request.url).searchParams;
    const requestedStatus = params.get("status") || "";
    const requestedCategory = params.get("category") || "";
    const query = (params.get("q") || "").trim();
    if (requestedStatus && !CONTACT_MESSAGE_STATUSES.includes(requestedStatus as ContactMessageStatus)) {
      return NextResponse.json({ error: "Unsupported contact-message status." }, { status: 400 });
    }
    if (requestedCategory && !CONTACT_CATEGORIES.includes(requestedCategory as ContactCategory)) {
      return NextResponse.json({ error: "Unsupported contact-message category." }, { status: 400 });
    }
    if (query.length > 100) {
      return NextResponse.json({ error: "Contact-message search is too long." }, { status: 400 });
    }
    const status = requestedStatus ? requestedStatus as ContactMessageStatus : null;
    const category = requestedCategory ? requestedCategory as ContactCategory : null;
    const messages = await listContactMessagesForExport(status, category, query);
    await queryRows(
      `
        insert into content_audit_log(entity_type, entity_id, action, actor_email, after_json)
        values ('public_contact_message', 'csv-export', 'export', $1, $2::jsonb)
      `,
      [actor.email, JSON.stringify({ status: status || "all", category: category || "all", queryApplied: Boolean(query), rowCount: messages.length })],
    );
    const headers = [
      "message_id", "category", "name", "email", "phone", "organization", "subject", "message",
      "status", "status_updated_by", "notification_status", "notification_detail", "notified_at",
      "consent_version", "consent_text", "consent_at", "source_path", "created_at", "updated_at", "resolved_at",
    ];
    const csv = rowsToCsv(headers, messages.map((message) => [
      message.publicId,
      message.category,
      message.name,
      message.email,
      message.phone,
      message.organization,
      message.subject,
      message.message,
      message.status,
      message.statusUpdatedBy,
      message.notificationStatus,
      message.notificationDetail,
      message.notifiedAt,
      message.consentVersion,
      message.consentText,
      message.consentAt,
      message.sourcePath,
      message.createdAt,
      message.updatedAt,
      message.resolvedAt,
    ]));
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="pastorwood-contact-messages-${date}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Content Manager role is required." }, { status: 403 });
    }
    console.error("Contact-message export failed.", error);
    return NextResponse.json(
      { error: "The contact-message export is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "300" } },
    );
  }
}
