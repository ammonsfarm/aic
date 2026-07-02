import "server-only";

import { queryRows } from "@/lib/db";

export type ContentAuditEvent = {
  id: number;
  entityType: string;
  entityId: string;
  action: string;
  actorEmail: string;
  createdAt: string;
};

type ContentAuditEventRow = {
  id: string | number;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_email: string;
  created_at: string;
};

function toNumber(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

function mapAudit(row: ContentAuditEventRow): ContentAuditEvent {
  return {
    id: toNumber(row.id),
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    actorEmail: row.actor_email,
    createdAt: row.created_at,
  };
}

export async function listContentAuditEvents(entityType: string, entityId: string): Promise<ContentAuditEvent[]> {
  const rows = await queryRows<ContentAuditEventRow>(
    `
      select id, entity_type, entity_id, action, actor_email, created_at::text
      from content_audit_log
      where entity_type = $1 and entity_id = $2
      order by created_at desc, id desc
    `,
    [entityType, entityId],
  );

  return rows.map(mapAudit);
}
