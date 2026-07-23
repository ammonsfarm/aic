import Link from "next/link";
import { redirect } from "next/navigation";

import { MountainPanel } from "@/components/mountain-panel";
import {
  contactInboxPath,
  listContactMessages,
  parseContactInboxFilter,
} from "@/lib/contact-messages";
import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  CONTACT_MESSAGE_STATUSES,
  CONTACT_MESSAGE_STATUS_LABELS,
  CONTACT_NOTIFICATION_STATUS_LABELS,
} from "@/lib/public-contact-contract";
import { requireContentManagerOrAdmin } from "@/lib/rbac";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default async function ContactInboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireContentManagerOrAdmin();
  const filter = parseContactInboxFilter(await searchParams);
  const { messages, total, totalPages } = await listContactMessages(filter);
  if (filter.page > totalPages) redirect(contactInboxPath(filter, totalPages));
  const exportQuery = new URLSearchParams();
  if (filter.status) exportQuery.set("status", filter.status);
  if (filter.category) exportQuery.set("category", filter.category);
  if (filter.query) exportQuery.set("q", filter.query);
  const exportHref = `/api/admin/contact-messages/export${exportQuery.size ? `?${exportQuery}` : ""}`;

  return (
    <div className="stack">
      <MountainPanel
        eyebrow="Public correspondence"
        title="Contact inbox"
        body="Review messages stored by the public contact form, track response status, and see notification delivery truthfully."
      />
      <section className="overview-primary">
        <form className="contact-inbox-filter" method="get" role="search">
          <label>
            <span>Search sender or subject</span>
            <input name="q" type="search" maxLength={100} defaultValue={filter.query} />
          </label>
          <label>
            <span>Status</span>
            <select name="status" defaultValue={filter.status || ""}>
              <option value="">All statuses</option>
              {CONTACT_MESSAGE_STATUSES.map((status) => (
                <option key={status} value={status}>{CONTACT_MESSAGE_STATUS_LABELS[status]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Message type</span>
            <select name="category" defaultValue={filter.category || ""}>
              <option value="">All message types</option>
              {CONTACT_CATEGORIES.map((category) => (
                <option key={category} value={category}>{CONTACT_CATEGORY_LABELS[category]}</option>
              ))}
            </select>
          </label>
          <div className="compact-actions">
            <button className="button" type="submit">Apply filters</button>
            <Link className="button button--ghost" href="/content/inbox">Clear</Link>
            {/* A plain anchor is required for an authenticated CSV attachment response. */}
            <a className="button button--ghost" href={exportHref}>Export CSV</a>
          </div>
        </form>
      </section>

      <section className="data-card">
        <div className="data-card__header">
          <div><p className="eyebrow">Inbox</p><h2>{total} stored {total === 1 ? "message" : "messages"}</h2></div>
          <span className="status-pill">Page {filter.page} of {totalPages}</span>
        </div>
        {messages.length ? (
          <div className="responsive-table" role="region" aria-label="Contact messages">
            <table>
              <thead><tr><th>Received</th><th>Sender</th><th>Type / subject</th><th>Status</th><th>Notification</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {messages.map((message) => (
                  <tr key={message.publicId}>
                    <td>{formatDate(message.createdAt)}</td>
                    <td><strong>{message.name}</strong><br /><span className="muted-copy">{message.email}</span></td>
                    <td><span className="status-pill">{CONTACT_CATEGORY_LABELS[message.category]}</span><br /><strong>{message.subject}</strong></td>
                    <td>{CONTACT_MESSAGE_STATUS_LABELS[message.status]}</td>
                    <td>{CONTACT_NOTIFICATION_STATUS_LABELS[message.notificationStatus]}</td>
                    <td><Link className="button button--ghost" href={`/content/inbox/${encodeURIComponent(message.publicId)}`}>Review</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="editor-form empty-state" role="status">
            <strong>No contact messages match these filters.</strong>
            <span>Clear the filters or return after a public message is submitted.</span>
          </div>
        )}
      </section>

      {totalPages > 1 ? (
        <nav className="contact-inbox-pagination" aria-label="Contact inbox pages">
          {filter.page > 1 ? <Link className="button button--ghost" href={contactInboxPath(filter, filter.page - 1)}>Previous</Link> : <span />}
          <span>Page {filter.page} of {totalPages}</span>
          {filter.page < totalPages ? <Link className="button button--ghost" href={contactInboxPath(filter, filter.page + 1)}>Next</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
