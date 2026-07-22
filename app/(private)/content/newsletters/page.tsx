import Link from "next/link";

import { MountainPanel } from "@/components/mountain-panel";
import { requireContentManagerOrAdmin } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function NewsletterSubscribersPage() {
  await requireContentManagerOrAdmin();
  return (
    <div className="stack">
      <MountainPanel
        eyebrow="Weekly devotional"
        title="Subscriber export"
        body="Download consented subscriber records captured by the public PastorWood form. This does not send email or modify suppression status."
      />
      <section className="overview-primary">
        <h2>Export active subscribers</h2>
        <p>The CSV contains email, consent version and date, source page, and record timestamps. Request fingerprints are intentionally excluded.</p>
        <div className="compact-actions">
          <a className="button button--primary" href="/api/admin/subscriptions/export?status=active">Download active subscribers</a>
          <a className="button button--ghost" href="/api/admin/subscriptions/export?status=all">Download all statuses</a>
          <Link className="button button--ghost" href="/content/posts">Manage devotional posts</Link>
        </div>
      </section>
    </div>
  );
}
