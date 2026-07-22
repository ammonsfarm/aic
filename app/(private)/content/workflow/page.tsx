import Link from "next/link";

import { getManagedStrapiPageSummary } from "@/lib/strapi-management";
import { getManagedSiteSettings } from "@/lib/strapi-site-settings-management";
import {
  getStructuredInventorySummary,
  listStructuredAuditEvents,
  type StructuredAuditEvent,
  type StructuredInventorySummary,
} from "@/lib/strapi-structured-management";
import {
  STRUCTURED_COLLECTION_KEYS,
  STRUCTURED_COLLECTIONS,
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
  if (event.entityType === "site-setting") {
    return "/content/site-settings";
  }
  if (event.entityType === "page") {
    return `/content/site-pages/${encodeURIComponent(event.entityDocumentId)}`;
  }
  const key = STRUCTURED_COLLECTION_KEYS.find(
    (candidate) => STRUCTURED_COLLECTIONS[candidate].entityType === event.entityType,
  );
  return key ? `${STRUCTURED_COLLECTIONS[key].editorPath}/${event.entityDocumentId}` : "";
}

type WorkflowInventoryItem = {
  key: string;
  entityType: string;
  label: string;
  href: string;
  summary: StructuredInventorySummary;
};

export default async function ContentWorkflowPage() {
  const structuredResults = await Promise.allSettled(
    STRUCTURED_COLLECTION_KEYS.map(async (key) => ({
      key: String(key),
      entityType: STRUCTURED_COLLECTIONS[key].entityType,
      label: STRUCTURED_COLLECTIONS[key].pluralLabel,
      href: STRUCTURED_COLLECTIONS[key].editorPath,
      summary: await getStructuredInventorySummary(key),
    })),
  );
  const [pagesResult, settingsResult] = await Promise.allSettled([
    getManagedStrapiPageSummary(),
    getManagedSiteSettings(),
  ]);

  const inventory: WorkflowInventoryItem[] = structuredResults.flatMap(
    (result) => result.status === "fulfilled" ? [result.value] : [],
  );
  if (pagesResult.status === "fulfilled") {
    inventory.unshift({
      key: "site-pages",
      entityType: "page",
      label: "Site pages",
      href: "/content/site-pages",
      summary: {
        total: pagesResult.value.total,
        draft: pagesResult.value.draft,
        published: pagesResult.value.published,
        archived: pagesResult.value.archived,
      },
    });
  }
  if (settingsResult.status === "fulfilled") {
    const settings = settingsResult.value;
    const total = settings ? 1 : 0;
    const publishedSettings = settings?.publicationStatus === "published" ? 1 : 0;
    inventory.unshift({
      key: "site-settings",
      entityType: "site-setting",
      label: "Site settings and navigation",
      href: "/content/site-settings",
      summary: {
        total,
        draft: total - publishedSettings,
        published: publishedSettings,
        archived: 0,
      },
    });
  }
  const inventoryError =
    structuredResults.some((result) => result.status === "rejected") ||
    pagesResult.status === "rejected" ||
    settingsResult.status === "rejected";
  let events: StructuredAuditEvent[] = [];
  let auditError = "";
  try {
    events = await listStructuredAuditEvents(100);
  } catch (cause) {
    console.error("Editorial audit lookup failed", cause);
    auditError = cause instanceof Error ? cause.message : "Audit events could not be loaded.";
  }

  const published = inventory.reduce((total, group) => total + group.summary.published, 0);
  const drafts = inventory.reduce((total, group) => total + group.summary.draft, 0);
  const archived = inventory.reduce((total, group) => total + group.summary.archived, 0);

  return (
    <div className="stack">
      <section className="signal-board">
        <div>
          <p className="eyebrow">Content / Workflow</p>
          <h1>Publishing workflow</h1>
          <p>Review current editorial state and the append-only attribution trail across every public content workflow.</p>
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
          <p>{auditError || "One or more editorial inventories could not be loaded."}</p>
        </section>
      ) : null}

      <section className="overview-grid" aria-label="Structured content collections">
        {inventory.map(({ key, entityType, label, href, summary }) => (
          <article className="overview-primary" key={key}>
            <p className="eyebrow">{entityType}</p>
            <h2>{label}</h2>
            <p>{summary.total} total · {summary.published} published · {summary.draft} draft · {summary.archived} archived</p>
            <Link className="button button--ghost" href={href}>Open inventory →</Link>
          </article>
        ))}
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
