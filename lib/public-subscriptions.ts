import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { queryRows } from "@/lib/db";
import {
  SUBSCRIPTION_ATTEMPT_RETENTION_DAYS,
  SUBSCRIPTION_CONSENT_TEXT,
  SUBSCRIPTION_CONSENT_VERSION,
} from "@/lib/public-subscription-contract";

const SUBSCRIPTION_ATTEMPT_CLEANUP_BATCH_SIZE = 500;

export type SubscriptionInput = {
  email: string;
  consent: true;
  consentVersion: string;
  sourcePath: string;
  startedAt: number;
};

export type SubscriptionValidation =
  | { ok: true; value: SubscriptionInput }
  | { ok: false; error: string; bot: boolean };

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeSubscriberEmail(value: unknown) {
  return stringValue(value).toLowerCase();
}

export function validateSubscriptionPayload(payload: unknown, now = Date.now()): SubscriptionValidation {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const email = normalizeSubscriberEmail(record.email);
  const website = stringValue(record.website);
  const consentVersion = stringValue(record.consentVersion);
  const sourceCandidate = stringValue(record.sourcePath) || "/";
  const sourcePath = /^\/[A-Za-z0-9/_-]{0,200}$/.test(sourceCandidate) ? sourceCandidate : "/";
  const startedAt = typeof record.startedAt === "number" ? record.startedAt : Number(record.startedAt);

  if (website) return { ok: false, error: "Unable to subscribe.", bot: true };
  if (!Number.isFinite(startedAt) || startedAt > now + 60_000 || now - startedAt > 86_400_000) {
    return { ok: false, error: "Please reload the page and try again.", bot: false };
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, error: "Enter a valid email address.", bot: false };
  }
  if (record.consent !== true || consentVersion !== SUBSCRIPTION_CONSENT_VERSION) {
    return { ok: false, error: "Please agree to receive the weekly devotional.", bot: false };
  }
  return { ok: true, value: { email, consent: true, consentVersion, sourcePath, startedAt } };
}

export class SubscriptionBodyTooLargeError extends Error {
  constructor() {
    super("Subscription request body is too large.");
    this.name = "SubscriptionBodyTooLargeError";
  }
}

export async function readSubscriptionJson(request: Request, maxBytes = 10_000): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new SubscriptionBodyTooLargeError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

function fingerprintSecret() {
  const value = process.env.SUBSCRIPTION_RATE_LIMIT_SECRET?.trim() || process.env.CLERK_SECRET_KEY?.trim() || "";
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error("Subscription capture is not configured.");
  }
  return value || "local-development-subscription-rate-limit";
}

export function subscriptionFingerprint(value: string) {
  return createHmac("sha256", fingerprintSecret()).update(value.slice(0, 1000)).digest("hex");
}

function unsubscribeSecret() {
  const value = process.env.SUBSCRIPTION_UNSUBSCRIBE_SECRET?.trim() || "";
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error("Subscription unsubscribe links are not configured.");
  }
  return value || "local-development-unsubscribe-secret";
}

export function subscriptionUnsubscribeToken(emailValue: string) {
  const email = normalizeSubscriberEmail(emailValue);
  if (!email || email.length > 254) throw new Error("A valid subscriber email is required.");
  const tokenId = createHmac("sha256", unsubscribeSecret())
    .update(`unsubscribe-id:v2:${email}`)
    .digest("base64url");
  const signature = createHmac("sha256", unsubscribeSecret())
    .update(`unsubscribe-signature:v2:${tokenId}`)
    .digest("base64url");
  return `${tokenId}.${signature}`;
}

export function verifySubscriptionUnsubscribeToken(tokenValue: unknown) {
  const token = stringValue(tokenValue);
  if (!/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [tokenId, suppliedSignature] = token.split(".");
  const expectedSignature = createHmac("sha256", unsubscribeSecret())
    .update(`unsubscribe-signature:v2:${tokenId}`)
    .digest("base64url");
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  return token;
}

export function subscriptionUnsubscribeTokenHash(tokenValue: unknown) {
  const token = verifySubscriptionUnsubscribeToken(tokenValue);
  return token ? createHash("sha256").update(token).digest("hex") : null;
}

export function subscriptionUnsubscribeUrl(email: string) {
  const configured = process.env.PASTORWOOD_PUBLIC_URL?.trim() || "http://localhost:3000";
  const origin = new URL(configured);
  if (process.env.NODE_ENV === "production" && origin.origin !== "https://www.pastorwood.org") {
    throw new Error("Production unsubscribe links require the canonical PastorWood origin.");
  }
  return new URL(`/unsubscribe?token=${encodeURIComponent(subscriptionUnsubscribeToken(email))}`, origin.origin).toString();
}

export function subscriptionRequestIdentity(request: Request) {
  const forwarded = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";
  return {
    ipHash: subscriptionFingerprint(forwarded.trim()),
    userAgentHash: subscriptionFingerprint(userAgent),
  };
}

type RateRow = { ip_count: string; email_count: string; cleaned_count: string };
type SubscriptionEventRow = { event_type: "consent-captured" | "resubscribe-blocked-suppressed" };

export type CapturePublicSubscriptionResult =
  | { ok: true }
  | { ok: false; reason: "rate-limited" | "suppressed" };

export async function capturePublicSubscription(
  input: SubscriptionInput,
  request: Request,
): Promise<CapturePublicSubscriptionResult> {
  const { ipHash, userAgentHash } = subscriptionRequestIdentity(request);
  const emailHash = subscriptionFingerprint(input.email);
  const unsubscribeTokenHash = subscriptionUnsubscribeTokenHash(subscriptionUnsubscribeToken(input.email));
  if (!unsubscribeTokenHash) {
    throw new Error("Subscription unsubscribe token could not be created.");
  }
  const rates = await queryRows<RateRow>(
    `
      with expired as (
        select id
        from public_subscription_attempts
        where created_at < now() - make_interval(days => $3::integer)
        order by created_at asc, id asc
        limit $4::integer
      ), cleanup as (
        delete from public_subscription_attempts attempts
        using expired
        where attempts.id = expired.id
        returning attempts.id
      )
      select
        count(*) filter (where ip_hash = $1 and created_at >= now() - interval '1 hour')::text as ip_count,
        count(*) filter (where email_hash = $2 and created_at >= now() - interval '1 day')::text as email_count,
        (select count(*) from cleanup)::text as cleaned_count
      from public_subscription_attempts
      where created_at >= now() - interval '1 day'
    `,
    [ipHash, emailHash, SUBSCRIPTION_ATTEMPT_RETENTION_DAYS, SUBSCRIPTION_ATTEMPT_CLEANUP_BATCH_SIZE],
  );
  const ipCount = Number(rates[0]?.ip_count || 0);
  const emailCount = Number(rates[0]?.email_count || 0);
  const rateLimited = ipCount >= 5 || emailCount >= 3;

  await queryRows(
    `insert into public_subscription_attempts(ip_hash, email_hash, accepted) values ($1, $2, $3)`,
    [ipHash, emailHash, !rateLimited],
  );
  if (rateLimited) return { ok: false, reason: "rate-limited" };

  const eventRows = await queryRows<SubscriptionEventRow>(
    `
      with upserted as (
        insert into public_subscriptions(
          email, status, consent_version, consent_text, consent_at,
          source_path, ip_hash, user_agent_hash, unsubscribe_token_hash,
          provider_status, provider_last_error, updated_at
        )
        values ($1, 'pending', $2, $3, now(), $4, $5, $6, $7, 'pending', null, now())
        on conflict (email) do update
        set status = case when public_subscriptions.status = 'suppressed' then 'suppressed' else 'pending' end,
            consent_version = excluded.consent_version,
            consent_text = excluded.consent_text,
            consent_at = excluded.consent_at,
            source_path = excluded.source_path,
            ip_hash = excluded.ip_hash,
            user_agent_hash = excluded.user_agent_hash,
            unsubscribe_token_hash = excluded.unsubscribe_token_hash,
            provider_status = case when public_subscriptions.status = 'suppressed' then public_subscriptions.provider_status else 'pending' end,
            provider_last_error = case when public_subscriptions.status = 'suppressed' then public_subscriptions.provider_last_error else null end,
            updated_at = now(),
            unsubscribed_at = case when public_subscriptions.status = 'suppressed' then public_subscriptions.unsubscribed_at else null end
        returning id, status
      ), recorded_event as (
      insert into public_subscription_events(subscription_id, event_type, actor_type, metadata)
      select id, case when status = 'suppressed' then 'resubscribe-blocked-suppressed' else 'consent-captured' end,
             'public-form', jsonb_build_object('consentVersion', $2::text, 'sourcePath', $4::text)
      from upserted
      returning subscription_id, event_type
      ), queued as (
        insert into public_subscription_provider_outbox(
          subscription_id, desired_action, status, generation, attempt_count,
          available_at, started_at, completed_at, worker_id, last_error, updated_at
        )
        select id, 'subscribe', 'queued', 1, 0, now(), null, null, '', '', now()
        from upserted
        where status = 'pending'
        on conflict (subscription_id) do update
        set desired_action = 'subscribe',
            status = 'queued',
            generation = public_subscription_provider_outbox.generation + 1,
            attempt_count = 0,
            available_at = now(),
            started_at = null,
            completed_at = null,
            worker_id = '',
            last_error = '',
            updated_at = now()
        returning subscription_id
      )
      select event_type from recorded_event
    `,
    [input.email, input.consentVersion, SUBSCRIPTION_CONSENT_TEXT, input.sourcePath, ipHash, userAgentHash, unsubscribeTokenHash],
  );
  const eventType = eventRows[0]?.event_type;
  if (eventType === "resubscribe-blocked-suppressed") return { ok: false, reason: "suppressed" };
  if (eventType === "consent-captured") return { ok: true };
  throw new Error("Subscription capture did not record an outcome event.");
}

export async function unsubscribePublicSubscription(tokenValue: unknown) {
  const tokenHash = subscriptionUnsubscribeTokenHash(tokenValue);
  if (!tokenHash) return { ok: false as const, invalidToken: true as const };
  const rows = await queryRows<{ subscription_id: string }>(
    `
      with updated as (
        update public_subscriptions
        set status = case when status = 'suppressed' then 'suppressed' else 'unsubscribed' end,
            unsubscribed_at = coalesce(unsubscribed_at, now()),
            provider_last_error = null,
            updated_at = now()
        where unsubscribe_token_hash = $1
        returning id, status
      ), recorded_event as (
      insert into public_subscription_events(subscription_id, event_type, actor_type, metadata)
      select id, case when status = 'suppressed' then 'unsubscribe-confirmed-suppressed' else 'unsubscribed' end,
             'signed-link', '{}'::jsonb
      from updated
      returning subscription_id
      ), queued as (
        insert into public_subscription_provider_outbox(
          subscription_id, desired_action, status, generation, attempt_count,
          available_at, started_at, completed_at, worker_id, last_error, updated_at
        )
        select id, 'unsubscribe', 'queued', 1, 0, now(), null, null, '', '', now()
        from updated
        on conflict (subscription_id) do update
        set desired_action = 'unsubscribe',
            status = 'queued',
            generation = public_subscription_provider_outbox.generation + 1,
            attempt_count = 0,
            available_at = now(),
            started_at = null,
            completed_at = null,
            worker_id = '',
            last_error = '',
            updated_at = now()
        returning subscription_id
      )
      select subscription_id::text from recorded_event
    `,
    [tokenHash],
  );
  return rows[0]
    ? { ok: true as const }
    : { ok: false as const, invalidToken: true as const };
}

export function isSameSiteSubscriptionRequest(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
