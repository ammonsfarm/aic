import Link from "next/link";

import {
  listStructuredAuditEvents,
  listStructuredEntries,
  type StructuredAuditEvent,
  type StructuredEntry,
} from "@/lib/strapi-structured-management";
import {
  STRUCTURED_COLLECTION_KEYS,
  STRUCTURED_COLLECTIONS,
  type StructuredCollectionKey,
} from "@/lib/structured-content-config";

export const dynamic = "force-dynamic";

function formatDate(value: string | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function eventHref(event: StructuredAuditEvent) {
  const key = STRUCTURED_COLLECTION_KEYS.find(
    (candidate) => STRUCTURED_COLLECTIONS[candidate].entityType === event.entityType,
  );
  return key ? `${STRUCTURED_COLLECTIONS[key].editorPath}/${event.entityDocumentId}` : "";
}

export default async function ContentWorkflowPage() {
  const results = await Promise.allSettled(
    STRUCTURED_COLLECTION_KEYS.map(async (key) => ({
      key,
      entries: await listStructuredEntries(key),
    })),
  );

  const inventory = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const inventoryError = results.some((result) => result.status === "rejected");
  let events: StructuredAuditEvent[] = [];
  let auditError = "";
  try {
    events = await listStructuredAuditEvents(100);
  } catch (cause) {
    console.error("Editorial audit lookup failed", cause);
    auditError = cause instanceof Error ? cause.message : "Audit events could not be loaded.";
  }

  const allEntries = inventory.flatMap((group) => group.entries);
  const published = allEntries.filter((entry) => entry.isPublished && !entry.archivedAt).length;
  const drafts = allEntries.filter((entry) => !entry.isPublished && !entry.archivedAt).length;
  const archived = allEntries.filter((entry) => Boolean(entry.archivedAt)).length;

  return (
    <div className="stack">
      <section className="signal-board">
        <div>
          <p className="eyebrow">Content / Workflow</p>
          <h1>Publishing workflow</h1>
          <p>Review current editorial state and the append-only attribution trail across structured public content.</p>
        </div>
        <div className="status-list" aria-label="Publishing state summary">
          <span><strong>{drafts}</strong>Draft</span>
          <span><strong>{published}</strong>Published</span>
          <span><strong>{archived}</strong>Archived</span>
        </div>
      </section>

      {inventoryError || auditError ? (
        <section className="notice-card" role="alert">
          <strong>Some workflow data is unavailable</strong>
          <p>{auditError || "One or more structured collections could not be loaded."}</p>
        </section>
      ) : null}

      <section className="overview-grid" aria-label="Structured content collections">
        {inventory.map(({ key, entries }: { key: StructuredCollectionKey; entries: StructuredEntry[] }) => {
          const definition = STRUCTURED_COLLECTIONS[key];
          return (
            <article className="overview-primary" key={key}>
              <p className="eyebrow">{definition.entityType}</p>
              <h2>{definition.pluralLabel}</h2>
              <p>{entries.length} total · {entries.filter((entry) => entry.isPublished).length} published · {entries.filter((entry) => entry.archivedAt).length} archived</p>
              <Link className="button button--ghost" href={definition.editorPath}>Open inventory →</Link>
            </article>
          );
        })}
      </section>

      <section className="data-card">
        <div className="data-card__header">
          <div><p className="eyebrow">Audit attribution</p><h2>Recent editorial actions</h2></div>
          <span className="status-pill">{events.length} events</span>
        </div>
        <div className="responsive-table" role="region" aria-label="Recent editorial audit events">
          <table>
            <thead><tr><th>Content</th><th>Type</th><th>Action</th><th>Editor</th><th>Note</th><th>When</th></tr></thead>
            <tbody>
              {events.map((event) => {
                const href = eventHref(event);
                return (
                  <tr key={event.documentId}>
                    <td>{href ? <Link href={href}><strong>{event.entityTitle || event.entityDocumentId}</strong></Link> : event.entityTitle || event.entityDocumentId}</td>
                    <td>{event.entityType}</td>
                    <td><span className="status-pill">{event.action}</span></td>
                    <td>{event.actorName || event.actorEmail}</td>
                    <td>{event.note || "—"}</td>
                    <td>{formatDate(event.createdAt)}</td>
                  </tr>
                );
              })}
              {!events.length ? <tr><td colSpan={6}><span className="muted-copy">No editorial actions have been recorded yet.</span></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
