import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import { queryRows } from "@/lib/db";
import {
  CONTACT_ARCHIVED_RETENTION_DAYS,
  CONTACT_ATTEMPT_RETENTION_DAYS,
  CONTACT_CATEGORIES,
  CONTACT_CONSENT_TEXT,
  CONTACT_CONSENT_VERSION,
  type ContactCategory,
} from "@/lib/public-contact-contract";

export const CONTACT_REQUEST_BODY_LIMIT = 16_384;
const CONTACT_CLEANUP_BATCH_SIZE = 250;

export type PublicContactInput = {
  category: ContactCategory;
  name: string;
  email: string;
  phone: string;
  organization: string;
  subject: string;
  message: string;
  consent: true;
  consentVersion: string;
  sourcePath: string;
  startedAt: number;
};

export type PublicContactValidation =
  | { ok: true; value: PublicContactInput }
  | { ok: false; error: string; bot: boolean };

const payloadKeys = new Set([
  "category",
  "name",
  "email",
  "phone",
  "organization",
  "subject",
  "message",
  "consent",
  "consentVersion",
  "sourcePath",
  "startedAt",
  "website",
]);

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function singleLine(value: unknown) {
  return stringValue(value).replace(/\s+/g, " ");
}

function hasUnsafeControlCharacters(value: string) {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

export function normalizeContactEmail(value: unknown) {
  return singleLine(value).toLowerCase();
}

export function validatePublicContactPayload(payload: unknown, now = Date.now()): PublicContactValidation {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Request body must be an object.", bot: false };
  }
  const record = payload as Record<string, unknown>;
  if (stringValue(record.website)) return { ok: false, error: "Unable to submit this message.", bot: true };
  if (Object.keys(record).some((key) => !payloadKeys.has(key))) {
    return { ok: false, error: "Request contains unsupported fields.", bot: false };
  }

  const category = singleLine(record.category) as ContactCategory;
  const name = singleLine(record.name);
  const email = normalizeContactEmail(record.email);
  const phone = singleLine(record.phone);
  const organization = singleLine(record.organization);
  const subject = singleLine(record.subject);
  const message = stringValue(record.message).replace(/\r\n?/g, "\n");
  const consentVersion = singleLine(record.consentVersion);
  const sourceCandidate = singleLine(record.sourcePath) || "/contact/";
  const sourcePath = /^\/[A-Za-z0-9/_-]{0,200}$/.test(sourceCandidate) ? sourceCandidate : "/contact/";
  const startedAt = typeof record.startedAt === "number" ? record.startedAt : Number(record.startedAt);

  if (!Number.isFinite(startedAt) || startedAt > now + 60_000 || now - startedAt > 86_400_000) {
    return { ok: false, error: "Please reload the page and try again.", bot: false };
  }
  if (!CONTACT_CATEGORIES.includes(category)) {
    return { ok: false, error: "Choose a valid message type.", bot: false };
  }
  if (name.length < 2 || name.length > 120 || hasUnsafeControlCharacters(name)) {
    return { ok: false, error: "Enter your name using 2 to 120 characters.", bot: false };
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { ok: false, error: "Enter a valid email address.", bot: false };
  }
  if (phone) {
    const digitCount = phone.replace(/\D/g, "").length;
    if (phone.length > 40 || digitCount < 7 || digitCount > 20 || !/^[0-9+().\-\sA-Za-z]*$/.test(phone)) {
      return { ok: false, error: "Enter a valid phone number or leave it blank.", bot: false };
    }
  }
  if (organization.length > 160 || hasUnsafeControlCharacters(organization)) {
    return { ok: false, error: "Organization must be 160 characters or fewer.", bot: false };
  }
  if (subject.length < 3 || subject.length > 160 || hasUnsafeControlCharacters(subject)) {
    return { ok: false, error: "Enter a subject using 3 to 160 characters.", bot: false };
  }
  if (message.length < 10 || message.length > 5_000 || hasUnsafeControlCharacters(message)) {
    return { ok: false, error: "Enter a message using 10 to 5,000 characters.", bot: false };
  }
  if (record.consent !== true || consentVersion !== CONTACT_CONSENT_VERSION) {
    return { ok: false, error: "Please agree to the contact-form privacy notice.", bot: false };
  }

  return {
    ok: true,
    value: {
      category,
      name,
      email,
      phone,
      organization,
      subject,
      message,
      consent: true,
      consentVersion,
      sourcePath,
      startedAt,
    },
  };
}

export class ContactBodyTooLargeError extends Error {
  constructor() {
    super("Contact request body is too large.");
    this.name = "ContactBodyTooLargeError";
  }
}

export async function readContactJson(request: Request, maxBytes = CONTACT_REQUEST_BODY_LIMIT): Promise<unknown> {
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
      throw new ContactBodyTooLargeError();
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

function contactFingerprintSecret() {
  const value = process.env.CONTACT_RATE_LIMIT_SECRET?.trim() || process.env.CLERK_SECRET_KEY?.trim() || "";
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error("Contact capture is not configured.");
  }
  return value || "local-development-contact-rate-limit";
}

export function contactFingerprint(value: string) {
  return createHmac("sha256", contactFingerprintSecret()).update(value.slice(0, 1_000)).digest("hex");
}

export function contactRequestIdentity(request: Request) {
  const forwarded = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";
  return {
    ipHash: contactFingerprint(forwarded.trim()),
    userAgentHash: contactFingerprint(userAgent),
  };
}

type ContactRateRow = { accepted: boolean };

export type CapturePublicContactResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "rate-limited" };

export async function capturePublicContactMessage(
  input: PublicContactInput,
  request: Request,
): Promise<CapturePublicContactResult> {
  const { ipHash, userAgentHash } = contactRequestIdentity(request);
  const senderHash = contactFingerprint(input.email);
  const rates = await queryRows<ContactRateRow>(
    `
      with locked as materialized (
        select pg_advisory_xact_lock(lock_key)
        from (
          select distinct hashtextextended(value, 0) as lock_key
          from unnest(array[$1::text, $2::text]) as lock_values(value)
          order by lock_key
        ) ordered_locks
      ), expired_attempts as (
        select id from public_contact_attempts
        where created_at < now() - make_interval(days => $3::integer)
        order by created_at asc, id asc
        limit $5::integer
      ), cleaned_attempts as (
        delete from public_contact_attempts attempts
        using expired_attempts expired
        where attempts.id = expired.id
        returning attempts.id
      ), expired_messages as (
        select id from public_contact_messages
        where status = 'archived'
          and updated_at < now() - make_interval(days => $4::integer)
        order by updated_at asc, id asc
        limit $6::integer
      ), cleaned_messages as (
        delete from public_contact_messages messages
        using expired_messages expired
        where messages.id = expired.id
        returning messages.id
      ), rates as (
        select
          count(*) filter (where ip_hash = $1 and created_at >= now() - interval '1 hour') as ip_count,
          count(*) filter (where sender_hash = $2 and created_at >= now() - interval '1 day') as sender_count
        from public_contact_attempts
        where created_at >= now() - interval '1 day'
          and (select count(*) from locked) >= 0
      ), attempted as (
        insert into public_contact_attempts(ip_hash, sender_hash, accepted)
        select $1, $2, ip_count < 5 and sender_count < 3
        from rates
        returning accepted
      )
      select accepted from attempted
    `,
    [
      ipHash,
      senderHash,
      CONTACT_ATTEMPT_RETENTION_DAYS,
      CONTACT_ARCHIVED_RETENTION_DAYS,
      CONTACT_CLEANUP_BATCH_SIZE,
      CONTACT_CLEANUP_BATCH_SIZE,
    ],
  );
  if (!rates[0]?.accepted) return { ok: false, reason: "rate-limited" };

  const messageId = randomUUID();
  const rows = await queryRows<{ public_id: string }>(
    `
      with inserted as (
        insert into public_contact_messages(
          public_id, category, name, email, phone, organization, subject, message,
          consent_version, consent_text, consent_at, source_path, ip_hash, user_agent_hash,
          notification_status, notification_detail
        )
        values ($1::uuid, $2, $3, $4, nullif($5, ''), nullif($6, ''), $7, $8,
                $9, $10, now(), $11, $12, $13, 'not_configured',
                'No notification provider is configured; review this message in the protected inbox.')
        returning id, public_id
      ), event as (
        insert into public_contact_message_events(contact_message_id, event_type, actor_type, metadata)
        select id, 'received', 'public_form', jsonb_build_object('sourcePath', $11::text)
        from inserted
        returning contact_message_id
      )
      select public_id::text from inserted
    `,
    [
      messageId,
      input.category,
      input.name,
      input.email,
      input.phone,
      input.organization,
      input.subject,
      input.message,
      input.consentVersion,
      CONTACT_CONSENT_TEXT,
      input.sourcePath,
      ipHash,
      userAgentHash,
    ],
  );
  if (rows[0]?.public_id !== messageId) throw new Error("Contact message was not durably stored.");
  return { ok: true, messageId };
}

export function isSameSiteContactRequest(request: Request) {
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
