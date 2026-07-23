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

type SubscriptionCaptureRow = {
  outcome: "success" | "suppressed" | "rate-limited";
  cleaned_count: string;
};

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
  const outcomes = await queryRows<SubscriptionCaptureRow>(
    `
      with lock_keys(lock_key) as materialized (
        select distinct lock_key
        from (values
          (hashtextextended('public-subscription-ip:' || $1::text, 0)),
          (hashtextextended('public-subscription-email:' || $2::text, 0))
        ) as requested(lock_key)
      ), locks as materialized (
        select pg_advisory_xact_lock(ordered_locks.lock_key) as acquired
        from (
          select lock_key
          from lock_keys
          order by lock_key
        ) ordered_locks
      ), lock_barrier as materialized (
        select count(*)::integer as acquired_count
        from locks
      ), expired as (
        select id
        from public_subscription_attempts, lock_barrier
        where created_at < now() - make_interval(days => $3::integer)
        order by created_at asc, id asc
        limit $4::integer
      ), cleanup as (
        delete from public_subscription_attempts attempts
        using expired
        where attempts.id = expired.id
        returning attempts.id
      ), rates as materialized (
        select
          count(*) filter (where ip_hash = $1 and created_at >= now() - interval '1 hour')::integer as ip_count,
          count(*) filter (where email_hash = $2 and created_at >= now() - interval '1 day')::integer as email_count,
          (select count(*) from cleanup)::integer as cleaned_count
        from public_subscription_attempts, lock_barrier
        where created_at >= now() - interval '1 day'
      ), decision as materialized (
        select ip_count >= 5 or email_count >= 3 as rate_limited, cleaned_count
        from rates
      ), attempted as (
        insert into public_subscription_attempts(ip_hash, email_hash, accepted)
        select $1, $2, not rate_limited
        from decision
        returning accepted
      ), upserted as (
        insert into public_subscriptions(
          email, status, consent_version, consent_text, consent_at,
          source_path, ip_hash, user_agent_hash, unsubscribe_token_hash,
          provider_status, provider_last_error, updated_at
        )
        select $5, 'pending', $6, $7, now(), $8, $1, $9, $10, 'pending', null, now()
        from decision
        cross join attempted
        where attempted.accepted and not decision.rate_limited
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
               'public-form', jsonb_build_object('consentVersion', $6::text, 'sourcePath', $8::text)
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
      ), outcome as (
        select case
          when decision.rate_limited then 'rate-limited'
          when recorded_event.event_type = 'resubscribe-blocked-suppressed' then 'suppressed'
          when recorded_event.event_type = 'consent-captured' then 'success'
          else null
        end as outcome,
        decision.cleaned_count
        from decision
        left join recorded_event on true
        left join (select count(*) as queued_count from queued) queued_result on true
      )
      select outcome, cleaned_count::text
      from outcome
      where outcome is not null
    `,
    [
      ipHash,
      emailHash,
      SUBSCRIPTION_ATTEMPT_RETENTION_DAYS,
      SUBSCRIPTION_ATTEMPT_CLEANUP_BATCH_SIZE,
      input.email,
      input.consentVersion,
      SUBSCRIPTION_CONSENT_TEXT,
      input.sourcePath,
      userAgentHash,
      unsubscribeTokenHash,
    ],
  );
  const outcome = outcomes[0]?.outcome;
  if (outcome === "rate-limited") return { ok: false, reason: "rate-limited" };
  if (outcome === "suppressed") return { ok: false, reason: "suppressed" };
  if (outcome === "success") return { ok: true };
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
