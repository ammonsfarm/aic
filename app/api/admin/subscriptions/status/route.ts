import { NextResponse } from "next/server";

import { queryRows } from "@/lib/db";
import { isSameSiteSubscriptionRequest, normalizeSubscriberEmail, readSubscriptionJson, SubscriptionBodyTooLargeError } from "@/lib/public-subscriptions";
import { isForbiddenError, requireContentManagerApiUser } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await requireContentManagerApiUser();
    if (!isSameSiteSubscriptionRequest(request)) return NextResponse.json({ error: "Cross-site requests are not accepted." }, { status: 403 });
    if ((request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
    }
    let payload: unknown;
    try {
      payload = await readSubscriptionJson(request, 2_000);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof SubscriptionBodyTooLargeError ? "Request is too large." : "Request body must be valid JSON." },
        { status: error instanceof SubscriptionBodyTooLargeError ? 413 : 400 },
      );
    }
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const email = normalizeSubscriberEmail(record.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || record.status !== "suppressed") {
      return NextResponse.json({ error: "A valid subscriber email and suppressed status are required." }, { status: 400 });
    }
    const rows = await queryRows<{ id: string }>(
      `
        with updated as (
          update public_subscriptions
          set status = 'suppressed', unsubscribed_at = coalesce(unsubscribed_at, now()), updated_at = now()
          where email = $1
          returning id
        ), event as (
          insert into public_subscription_events(subscription_id, event_type, actor_type, metadata)
          select id, 'admin-suppressed', 'content-manager', jsonb_build_object('actorEmail', $2::text)
          from updated
          returning subscription_id
        )
        insert into content_audit_log(entity_type, entity_id, action, actor_email, after_json)
        select 'public_subscription', subscription_id::text, 'suppress', $2, jsonb_build_object('status', 'suppressed')
        from event
        returning entity_id as id
      `,
      [email, actor.email],
    );
    if (!rows.length) return NextResponse.json({ error: "Subscriber not found." }, { status: 404 });
    return NextResponse.json({ ok: true, message: "Subscriber suppressed and audited." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isForbiddenError(error)) return NextResponse.json({ error: "Content Manager role is required." }, { status: 403 });
    throw error;
  }
}
