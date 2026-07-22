import Link from "next/link";

import { MountainPanel } from "@/components/mountain-panel";
import { SubscriberSuppressionForm } from "@/components/subscriber-suppression-form";
import { requireContentManagerOrAdmin } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function NewsletterSubscribersPage() {
  await requireContentManagerOrAdmin();
  return (
    <div className="stack">
      <MountainPanel
        eyebrow="Weekly devotional"
        title="Subscriber export"
        body="Download consented subscriber records, generate signed unsubscribe links for mail delivery, and audit permanent suppression requests."
      />
      <section className="overview-primary">
        <h2>Export active subscribers</h2>
        <p>The CSV contains email, consent version and date, source page, and record timestamps. Request fingerprints are intentionally excluded.</p>
        <div className="compact-actions">
          {/* A plain anchor is required for an authenticated CSV attachment response. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="button button--primary" href="/api/admin/subscriptions/export?status=active">Download active subscribers</a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="button button--ghost" href="/api/admin/subscriptions/export?status=all">Download all statuses</a>
          <Link className="button button--ghost" href="/content/posts">Manage devotional posts</Link>
        </div>
      </section>
      <section className="overview-primary">
        <h2>Suppress a subscriber</h2>
        <p>Use this for manual privacy or deliverability requests. Suppression is retained if the address later submits the public signup form.</p>
        <SubscriberSuppressionForm />
      </section>
    </div>
  );
}
