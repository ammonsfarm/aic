import Link from "next/link";

import { MountainPanel } from "@/components/mountain-panel";
import { SubscriberSuppressionForm } from "@/components/subscriber-suppression-form";
import { SubscriptionProviderRetryForm } from "@/components/subscription-provider-retry-form";
import { requireContentManagerOrAdmin } from "@/lib/rbac";
import { getSubscriptionProviderSummary } from "@/lib/subscription-provider-admin";
import { getPublishedManagedSiteSettings } from "@/lib/strapi-site-settings-management";
import { pastorWoodPublicCmsCutoverEnabled } from "@/lib/pastorwood-public-cms-cutover";

export const dynamic = "force-dynamic";

export default async function NewsletterSubscribersPage() {
  await requireContentManagerOrAdmin();
  const [summary, publishedLookup] = await Promise.all([
    getSubscriptionProviderSummary(),
    getPublishedManagedSiteSettings()
      .then((settings) => ({ available: true as const, settings }))
      .catch((error) => {
        console.error("Published site-settings readiness lookup failed", error);
        return { available: false as const, settings: null };
      }),
  ]);
  const publishedSettings = publishedLookup.settings;
  const providerReady = summary.provider.configured;
  const runtimeReady = summary.provider.publicCaptureEnabled;
  const cmsGateReady = publishedSettings?.subscriptionEnabled === true;
  const cmsGateUnavailable = !publishedLookup.available;
  const publicCutoverReady = pastorWoodPublicCmsCutoverEnabled();
  const publicSignupReady = providerReady && runtimeReady && cmsGateReady && publicCutoverReady;
  return (
    <div className="stack">
      <MountainPanel
        eyebrow="Weekly devotional"
        title="Subscriber export"
        body="Monitor double opt-in delivery, reconcile signed Mailchimp events, retry failures, export consent records, and audit permanent suppression requests."
      />
      <section className="overview-primary" aria-labelledby="subscription-delivery-heading">
        <div className="data-card__header">
          <div>
            <h2 id="subscription-delivery-heading">Mailchimp delivery</h2>
            <p>New signups remain pending until Mailchimp confirms double opt-in. Signed webhooks keep unsubscribe, bounce, and suppression state synchronized.</p>
          </div>
          <span className={`status-pill ${publicSignupReady ? "status-pill--good" : "status-pill--warn"}`}>
            {publicSignupReady ? "Public signup ready" : "Public signup disabled"}
          </span>
        </div>
        <div className="status-pills status-pills--compact" aria-label="Public signup readiness gates">
          <span className={providerReady ? "status-item status-item--active" : "status-item status-item--warn"}>
            Provider configuration: {providerReady ? "ready" : "incomplete"}
          </span>
          <span className={runtimeReady ? "status-item status-item--active" : "status-item status-item--warn"}>
            Runtime gate: {runtimeReady ? "enabled" : "disabled"}
          </span>
          <span className={cmsGateReady ? "status-item status-item--active" : "status-item status-item--warn"}>
            Published CMS gate: {cmsGateUnavailable ? "unavailable" : cmsGateReady ? "enabled" : "disabled"}
          </span>
          <span className={publicCutoverReady ? "status-item status-item--active" : "status-item status-item--warn"}>
            Public CMS cutover: {publicCutoverReady ? "enabled" : "bootstrap mode"}
          </span>
        </div>
        <div className="data-card responsive-table">
          <table>
            <caption className="sr-only">Subscriber and Mailchimp provider status summary</caption>
            <thead><tr><th scope="col">State</th><th scope="col">Subscribers</th><th scope="col">Provider / queue</th></tr></thead>
            <tbody>
              <tr><th scope="row">Pending confirmation</th><td>{summary.subscribers.pending}</td><td>{summary.provider.pending} provider pending</td></tr>
              <tr><th scope="row">Active</th><td>{summary.subscribers.active}</td><td>{summary.provider.subscribed} provider subscribed</td></tr>
              <tr><th scope="row">Unsubscribed / suppressed</th><td>{summary.subscribers.unsubscribed + summary.subscribers.suppressed}</td><td>{summary.provider.unsubscribed} unsubscribed, {summary.provider.cleaned} cleaned</td></tr>
              <tr><th scope="row">Provider attention</th><td>{summary.provider.unknown} unknown</td><td>{summary.provider.error} provider errors</td></tr>
              <tr><th scope="row">Outbox</th><td>{summary.outbox.queued} queued, {summary.outbox.running} running</td><td>{summary.outbox.failed} failed, {summary.outbox.exhausted} exhausted</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted-copy">
          Latest provider synchronization: {summary.provider.latestSyncAt ? new Date(summary.provider.latestSyncAt).toLocaleString("en-US", { timeZone: "America/New_York" }) : "No completed synchronization recorded"}.
        </p>
        {!providerReady ? (
          <p className="notice-card status-item--warn" role="status">Set all protected Mailchimp, signed-webhook, rate-limit, and unsubscribe settings with valid provider routing before enabling delivery. No secret value is displayed here.</p>
        ) : null}
        {!runtimeReady ? (
          <p className="notice-card status-item--warn" role="status">Public signup is explicitly disabled at runtime. Existing unsubscribe and provider-reconciliation work remains visible here.</p>
        ) : null}
        {cmsGateUnavailable ? (
          <p className="notice-card status-item--warn" role="status">The published CMS subscription setting could not be verified, so public signup remains disabled.</p>
        ) : !cmsGateReady ? (
          <p className="notice-card status-item--warn" role="status">Publish the CMS subscription switch only after provider configuration and the runtime gate are intentionally ready.</p>
        ) : null}
        {!publicCutoverReady ? (
          <p className="notice-card status-item--warn" role="status">The public site is intentionally using bootstrap continuity until the reviewed CMS publication batch is complete and the cutover gate is enabled.</p>
        ) : null}
        {summary.outbox.latestError ? <p className="notice-card status-item--warn" role="alert">Latest provider error: {summary.outbox.latestError}</p> : null}
        <SubscriptionProviderRetryForm disabled={!summary.outbox.failed} />
      </section>
      <section className="overview-primary">
        <h2>Export active subscribers</h2>
        <p>The CSV contains email, consent version and date, source page, and record timestamps. Request fingerprints are intentionally excluded.</p>
        <div className="compact-actions">
          {/* A plain anchor is required for an authenticated CSV attachment response. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="button button--primary" href="/api/admin/subscriptions/export?status=active">Download confirmed subscribers</a>
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
