import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { queryRows } from "@/lib/db";
import { normalizeSubscriberEmail, subscriptionFingerprint } from "@/lib/public-subscriptions";

export const DEFAULT_MAILCHIMP_AUDIENCE_ID = "9ad7bbba36";
const WEBHOOK_TOLERANCE_SECONDS = 300;

export type MailchimpWebhookEvent = {
  type: "subscribe" | "unsubscribe" | "cleaned";
  audienceId: string;
  email: string;
  memberId: string;
  firedAt: string;
};

export class MailchimpWebhookError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "MailchimpWebhookError";
    this.status = status;
  }
}

export function mailchimpAudienceId() {
  const value = process.env.MAILCHIMP_AUDIENCE_ID?.trim() || DEFAULT_MAILCHIMP_AUDIENCE_ID;
  if (!/^[a-f0-9]{10,32}$/i.test(value)) throw new Error("Mailchimp audience configuration is invalid.");
  return value;
}

function webhookSecret() {
  const value = process.env.MAILCHIMP_WEBHOOK_SECRET?.trim() || "";
  if (!value) throw new MailchimpWebhookError("Mailchimp webhook signing is not configured.", 503);
  return value;
}

export function verifyMailchimpWebhookSignature(
  rawBody: Uint8Array,
  signatureHeader: string | null,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const parts = new Map(
    (signatureHeader || "")
      .split(",")
      .map((part) => part.trim().split("=", 2) as [string, string])
      .filter(([key, value]) => Boolean(key && value)),
  );
  const timestampText = parts.get("t") || "";
  const suppliedHex = parts.get("v1") || "";
  if (!/^\d{10,}$/.test(timestampText) || !/^[a-f0-9]{64}$/i.test(suppliedHex)) {
    throw new MailchimpWebhookError("Mailchimp webhook signature is missing or malformed.", 401);
  }
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    throw new MailchimpWebhookError("Mailchimp webhook timestamp is outside the accepted window.", 401);
  }
  const expected = createHmac("sha256", webhookSecret())
    .update(`${timestampText}.`)
    .update(rawBody)
    .digest();
  const supplied = Buffer.from(suppliedHex, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new MailchimpWebhookError("Mailchimp webhook signature could not be verified.", 401);
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseMailchimpWebhook(rawBody: Uint8Array, contentType: string | null): MailchimpWebhookEvent {
  const mediaType = (contentType || "").split(";", 1)[0].trim().toLowerCase();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
  let type = "";
  let audienceId = "";
  let email = "";
  let memberId = "";
  let firedAt = "";

  if (mediaType === "application/json") {
    const record = objectRecord(JSON.parse(text));
    const data = objectRecord(record.data);
    type = stringValue(record.type);
    audienceId = stringValue(data.list_id ?? data.listId);
    email = normalizeSubscriberEmail(data.email);
    memberId = stringValue(data.id);
    firedAt = stringValue(record.fired_at ?? record.firedAt);
  } else if (mediaType === "application/x-www-form-urlencoded") {
    const form = new URLSearchParams(text);
    type = stringValue(form.get("type"));
    audienceId = stringValue(form.get("data[list_id]") || form.get("data[listId]"));
    email = normalizeSubscriberEmail(form.get("data[email]"));
    memberId = stringValue(form.get("data[id]"));
    firedAt = stringValue(form.get("fired_at") || form.get("firedAt"));
  } else {
    throw new MailchimpWebhookError("Mailchimp webhook Content-Type is not supported.", 415);
  }

  if (!["subscribe", "unsubscribe", "cleaned"].includes(type)) {
    throw new MailchimpWebhookError("Mailchimp webhook event type is not supported.");
  }
  if (audienceId !== mailchimpAudienceId()) throw new MailchimpWebhookError("Mailchimp webhook audience does not match.", 403);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    throw new MailchimpWebhookError("Mailchimp webhook subscriber is invalid.");
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(memberId)) throw new MailchimpWebhookError("Mailchimp webhook member is invalid.");
  if (!/^[0-9T: +Z.-]{1,64}$/.test(firedAt)) throw new MailchimpWebhookError("Mailchimp webhook timestamp is invalid.");

  return { type: type as MailchimpWebhookEvent["type"], audienceId, email, memberId, firedAt };
}

export function mailchimpWebhookEventKey(event: MailchimpWebhookEvent) {
  return createHash("sha256")
    .update([event.type, event.firedAt, event.audienceId, event.memberId, event.email].join("|"))
    .digest("hex");
}

export async function applyMailchimpWebhook(event: MailchimpWebhookEvent) {
  const eventKey = mailchimpWebhookEventKey(event);
  const importedIpHash = subscriptionFingerprint(`mailchimp-provider-ip:${event.email}`);
  const importedAgentHash = subscriptionFingerprint(`mailchimp-provider-agent:${event.email}`);
  const providerStatus = event.type === "subscribe" ? "subscribed" : event.type === "cleaned" ? "cleaned" : "unsubscribed";
  const eventType = event.type === "subscribe" ? "provider-confirmed" : event.type === "cleaned" ? "provider-cleaned" : "provider-unsubscribed";
  const rows = await queryRows<{ subscription_id: string }>(
    `
      with accepted_event as (
        insert into public_subscription_provider_webhook_events(event_key, event_type, provider_member_id)
        values ($1, $2, $3)
        on conflict (event_key) do nothing
        returning event_key
      ), upserted as (
        insert into public_subscriptions(
          email, status, consent_version, consent_text, consent_at, source_path,
          ip_hash, user_agent_hash, provider_status, provider_member_id,
          provider_synced_at, provider_last_error, unsubscribed_at, updated_at
        )
        select $4,
               case when $2 = 'subscribe' then 'active' when $2 = 'cleaned' then 'suppressed' else 'unsubscribed' end,
               'legacy-mailchimp-provider-v1',
               'Imported from the existing Pastor Wood Mailchimp audience; Mailchimp retains the original consent evidence.',
               now(), '/legacy-mailchimp', $5, $6, $7, $3, now(), null,
               case when $2 = 'subscribe' then null else now() end, now()
        from accepted_event
        on conflict (email) do update
        set status = case
              when public_subscriptions.status = 'suppressed' then 'suppressed'
              when $2 = 'subscribe' then 'active'
              when $2 = 'cleaned' then 'suppressed'
              else 'unsubscribed'
            end,
            provider_status = $7,
            provider_member_id = $3,
            provider_synced_at = now(),
            provider_last_error = null,
            unsubscribed_at = case
              when $2 = 'subscribe' and public_subscriptions.status <> 'suppressed' then null
              else coalesce(public_subscriptions.unsubscribed_at, now())
            end,
            updated_at = now()
        returning id, status
      ), recorded_event as (
        insert into public_subscription_events(subscription_id, event_type, actor_type, metadata)
        select id, $8, 'provider-webhook',
               jsonb_build_object('audienceId', $9::text, 'memberId', $3::text, 'firedAt', $10::text)
        from upserted
        returning subscription_id
      ), enforce_suppression as (
        insert into public_subscription_provider_outbox(
          subscription_id, desired_action, status, generation, attempt_count,
          available_at, started_at, completed_at, worker_id, last_error, updated_at
        )
        select id, 'unsubscribe', 'queued', 1, 0, now(), null, null, '', '', now()
        from upserted
        where status = 'suppressed' and $2 = 'subscribe'
        on conflict (subscription_id) do update
        set desired_action = 'unsubscribe', status = 'queued',
            generation = public_subscription_provider_outbox.generation + 1,
            attempt_count = 0, available_at = now(), started_at = null,
            completed_at = null, worker_id = '', last_error = '', updated_at = now()
        returning subscription_id
      )
      select subscription_id::text from recorded_event
    `,
    [eventKey, event.type, event.memberId, event.email, importedIpHash, importedAgentHash, providerStatus, eventType, event.audienceId, event.firedAt],
  );
  return { applied: rows.length > 0 };
}
