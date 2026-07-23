import Link from "next/link";
import { notFound } from "next/navigation";

import { ContactMessageStatusForm } from "@/components/contact-message-status-form";
import { RoutePanel } from "@/components/route-panel";
import { getContactMessage } from "@/lib/contact-messages";
import {
  CONTACT_CATEGORY_LABELS,
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
    timeStyle: "long",
  }).format(date);
}

export default async function ContactMessagePage({ params }: { params: Promise<{ messageId: string }> }) {
  await requireContentManagerOrAdmin();
  const { messageId } = await params;
  const result = await getContactMessage(messageId);
  if (!result) notFound();
  const { message, events } = result;

  return (
    <RoutePanel
      eyebrow="Contact inbox"
      title={message.subject}
      actions={<Link className="button button--ghost" href="/content/inbox">Back to inbox</Link>}
      aside={
        <div className="stack">
          <div className="status-list">
            <span><strong>{CONTACT_MESSAGE_STATUS_LABELS[message.status]}</strong>Workflow status</span>
            <span><strong>{CONTACT_NOTIFICATION_STATUS_LABELS[message.notificationStatus]}</strong>Notification state</span>
            <span><strong>{formatDate(message.createdAt)}</strong>Received</span>
            <span><strong>{CONTACT_CATEGORY_LABELS[message.category]}</strong>Message type</span>
          </div>
          <ContactMessageStatusForm
            publicId={message.publicId}
            currentStatus={message.status}
            expectedUpdatedAt={message.updatedAt}
          />
        </div>
      }
    >
      <div className="stack">
        <section className="data-card">
          <div className="data-card__header"><div><p className="eyebrow">Sender</p><h2>{message.name}</h2></div></div>
          <dl className="contact-message-details">
            <div><dt>Email</dt><dd><a href={`mailto:${message.email}`}>{message.email}</a></dd></div>
            <div><dt>Phone</dt><dd>{message.phone || "Not provided"}</dd></div>
            <div><dt>Organization</dt><dd>{message.organization || "Not provided"}</dd></div>
            <div><dt>Source page</dt><dd>{message.sourcePath}</dd></div>
          </dl>
        </section>
        <section className="data-card">
          <div className="data-card__header"><div><p className="eyebrow">Message</p><h2>{message.subject}</h2></div></div>
          <div className="contact-message-copy">{message.message}</div>
        </section>
        <section className="data-card">
          <div className="data-card__header"><div><p className="eyebrow">Privacy record</p><h2>Consent and delivery</h2></div></div>
          <dl className="contact-message-details">
            <div><dt>Consent accepted</dt><dd>{formatDate(message.consentAt)}</dd></div>
            <div><dt>Consent version</dt><dd>{message.consentVersion}</dd></div>
            <div><dt>Consent wording</dt><dd>{message.consentText}</dd></div>
            <div><dt>Notification detail</dt><dd>{message.notificationDetail || "No notification detail recorded."}</dd></div>
            <div><dt>Notified</dt><dd>{formatDate(message.notifiedAt)}</dd></div>
          </dl>
        </section>
        <section className="data-card">
          <div className="data-card__header"><div><p className="eyebrow">Audit</p><h2>Message history</h2></div></div>
          {events.length ? (
            <div className="responsive-table" role="region" aria-label="Contact message audit history">
              <table>
                <thead><tr><th>When</th><th>Event</th><th>Actor</th><th>Note</th></tr></thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td>{formatDate(event.createdAt)}</td>
                      <td>{event.eventType.replaceAll("_", " ")}</td>
                      <td>{event.actorEmail || event.actorType.replaceAll("_", " ")}</td>
                      <td>{event.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="editor-form empty-state" role="status"><strong>No audit events found.</strong><span>The message record remains available.</span></div>
          )}
        </section>
      </div>
    </RoutePanel>
  );
}
