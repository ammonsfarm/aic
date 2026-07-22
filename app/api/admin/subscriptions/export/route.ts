import { NextResponse } from "next/server";

import { queryRows } from "@/lib/db";
import { subscriptionUnsubscribeUrl } from "@/lib/public-subscriptions";
import { isForbiddenError, requireContentManagerApiUser } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type SubscriptionRow = {
  email: string;
  status: string;
  consent_version: string;
  consent_at: string;
  source_path: string;
  created_at: string;
  updated_at: string;
};

function spreadsheetSafe(value: string) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string) {
  return `"${spreadsheetSafe(value).replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  try {
    const actor = await requireContentManagerApiUser();
    const requestedStatus = new URL(request.url).searchParams.get("status") || "active";
    const status = requestedStatus === "all" ? null : requestedStatus;
    if (status && !["active", "unsubscribed", "suppressed"].includes(status)) {
      return NextResponse.json({ error: "Unsupported subscription status." }, { status: 400 });
    }
    const rows = await queryRows<SubscriptionRow>(
      `
        select email, status, consent_version, consent_at::text,
               source_path, created_at::text, updated_at::text
        from public_subscriptions
        where ($1::text is null or status = $1)
        order by created_at asc, id asc
      `,
      [status],
    );
    await queryRows(
      `
        insert into content_audit_log(entity_type, entity_id, action, actor_email, after_json)
        values ('public_subscription', 'csv-export', 'export', $1, $2::jsonb)
      `,
      [actor.email, JSON.stringify({ status: status || "all", rowCount: rows.length })],
    );
    const header = ["email", "status", "consent_version", "consent_at", "source_path", "created_at", "updated_at", "unsubscribe_url"];
    const csv = [
      header.join(","),
      ...rows.map((row) => [
        row.email,
        row.status,
        row.consent_version,
        row.consent_at,
        row.source_path,
        row.created_at,
        row.updated_at,
        subscriptionUnsubscribeUrl(row.email),
      ].map(csvCell).join(",")),
    ].join("\r\n") + "\r\n";
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="pastorwood-subscribers-${date}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Content Manager role is required." }, { status: 403 });
    }
    throw error;
  }
}
