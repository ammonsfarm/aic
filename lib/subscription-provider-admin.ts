import "server-only";

import { queryRows } from "@/lib/db";
import {
  publicSubscriptionCaptureEnabled,
  subscriptionProviderConfigReady,
} from "@/lib/subscription-provider-config";

export type SubscriptionProviderSummary = {
  subscribers: {
    pending: number;
    active: number;
    unsubscribed: number;
    suppressed: number;
  };
  provider: {
    configured: boolean;
    webhookConfigured: boolean;
    publicCaptureEnabled: boolean;
    unknown: number;
    pending: number;
    subscribed: number;
    unsubscribed: number;
    cleaned: number;
    error: number;
    latestSyncAt: string | null;
  };
  outbox: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    exhausted: number;
    latestError: string;
  };
};

type SummaryRow = Record<string, string | null>;

function count(row: SummaryRow, key: string) {
  return Number(row[key] || 0);
}

export async function getSubscriptionProviderSummary(): Promise<SubscriptionProviderSummary> {
  const rows = await queryRows<SummaryRow>(
    `
      select
        count(*) filter (where subscriptions.status = 'pending')::text as subscriber_pending,
        count(*) filter (where subscriptions.status = 'active')::text as subscriber_active,
        count(*) filter (where subscriptions.status = 'unsubscribed')::text as subscriber_unsubscribed,
        count(*) filter (where subscriptions.status = 'suppressed')::text as subscriber_suppressed,
        count(*) filter (where subscriptions.provider_status = 'unknown')::text as provider_unknown,
        count(*) filter (where subscriptions.provider_status = 'pending')::text as provider_pending,
        count(*) filter (where subscriptions.provider_status = 'subscribed')::text as provider_subscribed,
        count(*) filter (where subscriptions.provider_status = 'unsubscribed')::text as provider_unsubscribed,
        count(*) filter (where subscriptions.provider_status = 'cleaned')::text as provider_cleaned,
        count(*) filter (where subscriptions.provider_status = 'error')::text as provider_error,
        max(subscriptions.provider_synced_at)::text as latest_provider_sync_at,
        (select count(*)::text from public_subscription_provider_outbox where status = 'queued') as outbox_queued,
        (select count(*)::text from public_subscription_provider_outbox where status = 'running') as outbox_running,
        (select count(*)::text from public_subscription_provider_outbox where status = 'completed') as outbox_completed,
        (select count(*)::text from public_subscription_provider_outbox where status = 'failed') as outbox_failed,
        (select count(*)::text from public_subscription_provider_outbox where status = 'failed' and attempt_count >= 10) as outbox_exhausted,
        coalesce((
          select provider_last_error from public_subscriptions
          where provider_last_error is not null and provider_last_error <> ''
          order by updated_at desc limit 1
        ), (
          select last_error from public_subscription_provider_outbox
          where status = 'failed' and last_error <> ''
          order by updated_at desc limit 1
        ), '') as latest_error
      from public_subscriptions subscriptions
    `,
  );
  const row = rows[0] || {};
  return {
    subscribers: {
      pending: count(row, "subscriber_pending"),
      active: count(row, "subscriber_active"),
      unsubscribed: count(row, "subscriber_unsubscribed"),
      suppressed: count(row, "subscriber_suppressed"),
    },
    provider: {
      configured: subscriptionProviderConfigReady(),
      webhookConfigured: Boolean(process.env.MAILCHIMP_WEBHOOK_SECRET?.trim()),
      publicCaptureEnabled: publicSubscriptionCaptureEnabled(),
      unknown: count(row, "provider_unknown"),
      pending: count(row, "provider_pending"),
      subscribed: count(row, "provider_subscribed"),
      unsubscribed: count(row, "provider_unsubscribed"),
      cleaned: count(row, "provider_cleaned"),
      error: count(row, "provider_error"),
      latestSyncAt: row.latest_provider_sync_at || null,
    },
    outbox: {
      queued: count(row, "outbox_queued"),
      running: count(row, "outbox_running"),
      completed: count(row, "outbox_completed"),
      failed: count(row, "outbox_failed"),
      exhausted: count(row, "outbox_exhausted"),
      latestError: row.latest_error || "",
    },
  };
}
