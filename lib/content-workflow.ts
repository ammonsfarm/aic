import "server-only";

import { queryRows } from "@/lib/db";

export type ContentWorkflowEvent = {
  id: number;
  entityType: string;
  entityId: string;
  fromStatus: string | null;
  toStatus: string;
  note: string;
  actorEmail: string;
  createdAt: string;
};

type ContentWorkflowEventRow = {
  id: string | number;
  entity_type: string;
  entity_id: string;
  from_status: string | null;
  to_status: string;
  note: string;
  actor_email: string;
  created_at: string;
};

function toNumber(value: string | number) {
  return typeof value === "number" ? value : Number(value);
}

function mapEvent(row: ContentWorkflowEventRow): ContentWorkflowEvent {
  return {
    id: toNumber(row.id),
    entityType: row.entity_type,
    entityId: row.entity_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note,
    actorEmail: row.actor_email,
    createdAt: row.created_at,
  };
}

export async function listContentWorkflowEvents(entityType: string, entityId: string): Promise<ContentWorkflowEvent[]> {
  const rows = await queryRows<ContentWorkflowEventRow>(
    `
      select id, entity_type, entity_id, from_status, to_status, note, actor_email, created_at::text
      from content_workflow_events
      where entity_type = $1 and entity_id = $2
      order by created_at desc, id desc
    `,
    [entityType, entityId],
  );

  return rows.map(mapEvent);
}
