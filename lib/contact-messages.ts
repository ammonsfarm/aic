import "server-only";

import { queryRows } from "@/lib/db";
import {
  CONTACT_CATEGORIES,
  CONTACT_MESSAGE_STATUSES,
  CONTACT_NOTIFICATION_STATUSES,
  type ContactCategory,
  type ContactMessageStatus,
  type ContactNotificationStatus,
} from "@/lib/public-contact-contract";
import type { CurrentAppUser } from "@/lib/rbac";

export const CONTACT_INBOX_PAGE_SIZE = 25;

export type ContactInboxFilter = {
  status: ContactMessageStatus | null;
  category: ContactCategory | null;
  query: string;
  page: number;
};

export type ContactMessageSummary = {
  publicId: string;
  category: ContactCategory;
  name: string;
  email: string;
  subject: string;
  status: ContactMessageStatus;
  notificationStatus: ContactNotificationStatus;
  createdAt: string;
  updatedAt: string;
};

export type ContactMessageDetail = ContactMessageSummary & {
  phone: string;
  organization: string;
  message: string;
  statusUpdatedBy: string;
  consentVersion: string;
  consentText: string;
  consentAt: string;
  sourcePath: string;
  notificationDetail: string;
  notifiedAt: string;
  resolvedAt: string;
};

export type ContactMessageEvent = {
  id: string;
  eventType: string;
  actorType: string;
  actorEmail: string;
  note: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type ContactRow = {
  public_id: string;
  category: string;
  name: string;
  email: string;
  phone?: string | null;
  organization?: string | null;
  subject: string;
  message?: string;
  status: string;
  status_updated_by?: string | null;
  consent_version?: string;
  consent_text?: string;
  consent_at?: string;
  source_path?: string;
  notification_status: string;
  notification_detail?: string | null;
  notified_at?: string | null;
  created_at: string;
  updated_at: string;
  resolved_at?: string | null;
};

type ContactEventRow = {
  id: string;
  event_type: string;
  actor_type: string;
  actor_email: string | null;
  note: string | null;
  metadata: unknown;
  created_at: string;
};

function contactCategory(value: string): ContactCategory {
  return CONTACT_CATEGORIES.includes(value as ContactCategory) ? value as ContactCategory : "general";
}

function contactStatus(value: string): ContactMessageStatus {
  return CONTACT_MESSAGE_STATUSES.includes(value as ContactMessageStatus) ? value as ContactMessageStatus : "new";
}

function notificationStatus(value: string): ContactNotificationStatus {
  return CONTACT_NOTIFICATION_STATUSES.includes(value as ContactNotificationStatus)
    ? value as ContactNotificationStatus
    : "not_configured";
}

function summaryFromRow(row: ContactRow): ContactMessageSummary {
  return {
    publicId: row.public_id,
    category: contactCategory(row.category),
    name: row.name,
    email: row.email,
    subject: row.subject,
    status: contactStatus(row.status),
    notificationStatus: notificationStatus(row.notification_status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function detailFromRow(row: ContactRow): ContactMessageDetail {
  return {
    ...summaryFromRow(row),
    phone: row.phone || "",
    organization: row.organization || "",
    message: row.message || "",
    statusUpdatedBy: row.status_updated_by || "",
    consentVersion: row.consent_version || "",
    consentText: row.consent_text || "",
    consentAt: row.consent_at || "",
    sourcePath: row.source_path || "/contact/",
    notificationDetail: row.notification_detail || "",
    notifiedAt: row.notified_at || "",
    resolvedAt: row.resolved_at || "",
  };
}

export function isContactMessagePublicId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseContactInboxFilter(params: Record<string, string | string[] | undefined>): ContactInboxFilter {
  const requestedStatus = firstValue(params.status) || "";
  const requestedCategory = firstValue(params.category) || "";
  const rawQuery = (firstValue(params.q) || "").trim();
  const requestedPage = Number(firstValue(params.page) || 1);
  return {
    status: CONTACT_MESSAGE_STATUSES.includes(requestedStatus as ContactMessageStatus)
      ? requestedStatus as ContactMessageStatus
      : null,
    category: CONTACT_CATEGORIES.includes(requestedCategory as ContactCategory)
      ? requestedCategory as ContactCategory
      : null,
    query: rawQuery.slice(0, 100),
    page: Number.isInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 1_000 ? requestedPage : 1,
  };
}

export function contactInboxPath(filter: ContactInboxFilter, page = filter.page) {
  const query = new URLSearchParams();
  if (filter.status) query.set("status", filter.status);
  if (filter.category) query.set("category", filter.category);
  if (filter.query) query.set("q", filter.query);
  if (page > 1) query.set("page", String(page));
  const suffix = query.toString();
  return `/content/inbox${suffix ? `?${suffix}` : ""}`;
}

export async function listContactMessages(filter: ContactInboxFilter) {
  const values = [filter.status, filter.category, filter.query || null];
  const where = `
    where ($1::text is null or status = $1)
      and ($2::text is null or category = $2)
      and ($3::text is null or subject ilike '%' || $3 || '%' or name ilike '%' || $3 || '%' or email ilike '%' || $3 || '%')
  `;
  const [countRows, messageRows] = await Promise.all([
    queryRows<{ total: string }>(`select count(*)::text as total from public_contact_messages ${where}`, values),
    queryRows<ContactRow>(
      `
        select public_id::text, category, name, email, subject, status, notification_status,
               created_at::text, updated_at::text
        from public_contact_messages
        ${where}
        order by created_at desc, id desc
        limit $4::integer offset $5::integer
      `,
      [...values, CONTACT_INBOX_PAGE_SIZE, (filter.page - 1) * CONTACT_INBOX_PAGE_SIZE],
    ),
  ]);
  const total = Number(countRows[0]?.total || 0);
  return {
    messages: messageRows.map(summaryFromRow),
    total,
    totalPages: Math.max(1, Math.ceil(total / CONTACT_INBOX_PAGE_SIZE)),
  };
}

export async function getContactMessage(publicId: string) {
  if (!isContactMessagePublicId(publicId)) return null;
  const rows = await queryRows<ContactRow>(
    `
      select public_id::text, category, name, email, coalesce(phone, '') as phone,
             coalesce(organization, '') as organization, subject, message, status,
             coalesce(status_updated_by, '') as status_updated_by,
             consent_version, consent_text, consent_at::text, source_path,
             notification_status, coalesce(notification_detail, '') as notification_detail,
             coalesce(notified_at::text, '') as notified_at, created_at::text, updated_at::text,
             coalesce(resolved_at::text, '') as resolved_at
      from public_contact_messages
      where public_id = $1::uuid
      limit 1
    `,
    [publicId],
  );
  if (!rows[0]) return null;
  const eventRows = await queryRows<ContactEventRow>(
    `
      select events.id::text, events.event_type, events.actor_type, events.actor_email,
             events.note, events.metadata, events.created_at::text
      from public_contact_message_events events
      join public_contact_messages messages on messages.id = events.contact_message_id
      where messages.public_id = $1::uuid
      order by events.created_at desc, events.id desc
    `,
    [publicId],
  );
  return {
    message: detailFromRow(rows[0]),
    events: eventRows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      actorType: row.actor_type,
      actorEmail: row.actor_email || "",
      note: row.note || "",
      metadata: row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {},
      createdAt: row.created_at,
    })),
  };
}

export async function updateContactMessageStatus(input: {
  publicId: string;
  status: ContactMessageStatus;
  expectedUpdatedAt: string;
  note: string;
  actor: CurrentAppUser;
}) {
  const rows = await queryRows<{ public_id: string; updated_at: string }>(
    `
      with updated as (
        update public_contact_messages
        set status = $2,
            status_updated_by = $4,
            updated_at = now(),
            resolved_at = case
              when $2 = 'resolved' then coalesce(resolved_at, now())
              when $2 = 'archived' then resolved_at
              else null
            end
        where public_id = $1::uuid and updated_at = $3::timestamptz
        returning id, public_id, status, updated_at
      ), event as (
        insert into public_contact_message_events(
          contact_message_id, event_type, actor_type, actor_email, note, metadata
        )
        select id, 'status_changed', 'content_manager', $4, nullif($5, ''),
               jsonb_build_object('status', status)
        from updated
        returning contact_message_id
      ), audit as (
        insert into content_audit_log(entity_type, entity_id, action, actor_email, after_json)
        select 'public_contact_message', public_id::text, 'status-change', $4,
               jsonb_build_object('status', status, 'note', nullif($5, ''))
        from updated
        returning entity_id
      )
      select public_id::text, updated_at::text from updated
    `,
    [input.publicId, input.status, input.expectedUpdatedAt, input.actor.email, input.note],
  );
  if (rows[0]) return { ok: true as const, updatedAt: rows[0].updated_at };
  const current = await queryRows<{ updated_at: string }>(
    "select updated_at::text from public_contact_messages where public_id = $1::uuid limit 1",
    [input.publicId],
  );
  return current[0]
    ? { ok: false as const, reason: "conflict" as const }
    : { ok: false as const, reason: "not-found" as const };
}

export async function listContactMessagesForExport(
  status: ContactMessageStatus | null,
  category: ContactCategory | null,
  query = "",
) {
  return queryRows<ContactRow>(
    `
      select public_id::text, category, name, email, coalesce(phone, '') as phone,
             coalesce(organization, '') as organization, subject, message, status,
             coalesce(status_updated_by, '') as status_updated_by,
             consent_version, consent_text, consent_at::text, source_path,
             notification_status, coalesce(notification_detail, '') as notification_detail,
             coalesce(notified_at::text, '') as notified_at, created_at::text, updated_at::text,
             coalesce(resolved_at::text, '') as resolved_at
      from public_contact_messages
      where ($1::text is null or status = $1)
        and ($2::text is null or category = $2)
        and ($3::text is null or subject ilike '%' || $3 || '%' or name ilike '%' || $3 || '%' or email ilike '%' || $3 || '%')
      order by created_at asc, id asc
    `,
    [status, category, query || null],
  ).then((rows) => rows.map(detailFromRow));
}
