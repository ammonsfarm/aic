import { NextResponse } from "next/server";

import { queryRows } from "@/lib/db";
import { isSameSiteSubscriptionRequest } from "@/lib/public-subscriptions";
import { isForbiddenError, requireContentManagerApiUser } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await requireContentManagerApiUser();
    if (!isSameSiteSubscriptionRequest(request)) {
      return NextResponse.json({ error: "Cross-site requests are not accepted." }, { status: 403 });
    }
    const rows = await queryRows<{ retried_count: string }>(
      `
        with retried as (
          update public_subscription_provider_outbox
             set status = 'queued', attempt_count = 0, available_at = now(),
                 started_at = null, completed_at = null, worker_id = '',
                 last_error = '', generation = generation + 1, updated_at = now()
           where status = 'failed'
           returning subscription_id
        ), events as (
          insert into public_subscription_events(subscription_id, event_type, actor_type, metadata)
          select subscription_id, 'provider-sync-retried', 'content-manager',
                 jsonb_build_object('actorEmail', $1::text)
          from retried
          returning subscription_id
        ), audit as (
          insert into content_audit_log(entity_type, entity_id, action, actor_email, after_json)
          select 'public_subscription_provider', 'failed-outbox', 'retry', $1,
                 jsonb_build_object('rowCount', count(*))
          from events
          returning id
        )
        select count(*)::text as retried_count from events
      `,
      [actor.email],
    );
    const retried = Number(rows[0]?.retried_count || 0);
    return NextResponse.json(
      { ok: true, retried, message: retried ? `${retried} provider sync request${retried === 1 ? "" : "s"} queued.` : "No failed provider sync requests needed retrying." },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Content Manager role is required." }, { status: 403 });
    }
    console.error("Subscription provider retry failed.", error);
    return NextResponse.json(
      { error: "Provider retries are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  }
}
