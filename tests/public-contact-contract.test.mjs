import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("contact capture stays public, bounded, durable, and independent of Strapi", async () => {
  const [proxy, route, capture, migration] = await Promise.all([
    source("proxy.ts"),
    source("app/api/public/contact/route.ts"),
    source("lib/public-contact.ts"),
    source("postgres/migrations/024_public_contact_messages.sql"),
  ]);
  assert.match(proxy, /"\/api\/public\/contact"/);
  assert.match(route, /CONTACT_REQUEST_BODY_LIMIT/);
  assert.match(route, /status: 503/);
  assert.match(route, /Cache-Control": "no-store"/);
  assert.match(capture, /CONTACT_RATE_LIMIT_SECRET/);
  assert.match(capture, /createHmac\("sha256"/);
  assert.match(capture, /'not_configured'/);
  assert.doesNotMatch(migration, /\b(?:raw_ip|ip_address|user_agent)\s+text\b/i);
  assert.match(migration, /ip_hash text not null/);
  assert.match(migration, /user_agent_hash text not null/);
  assert.match(migration, /public_contact_message_events/);
});

test("only the exact signed Mailchimp webhook endpoint bypasses Clerk", async () => {
  const [proxy, route] = await Promise.all([
    source("proxy.ts"),
    source("app/api/webhooks/mailchimp/route.ts"),
  ]);
  assert.match(proxy, /"\/api\/webhooks\/mailchimp"/);
  assert.doesNotMatch(proxy, /"\/api\/webhooks\/mailchimp\(\.\*\)"/);
  assert.match(route, /verifyMailchimpWebhookSignature\(rawBody/);
  assert.match(route, /MAX_WEBHOOK_BYTES = 100_000/);
});

test("subscription readiness and admin status use the same complete provider contract", async () => {
  const [route, config, admin, page] = await Promise.all([
    source("app/api/public/subscriptions/route.ts"),
    source("lib/subscription-provider-config.ts"),
    source("lib/subscription-provider-admin.ts"),
    source("app/(private)/content/newsletters/page.tsx"),
  ]);
  assert.match(config, /PASTORWOOD_SUBSCRIPTIONS_ENABLED/);
  assert.match(route, /publicSubscriptionCaptureEnabled\(\)/);
  assert.match(route, /getStrapiSiteSettings\(\)/);
  assert.match(route, /settings\?\.subscriptionEnabled !== true/);
  assert.match(admin, /configured: subscriptionProviderConfigReady\(\)/);
  assert.match(admin, /publicCaptureEnabled: publicSubscriptionCaptureEnabled\(\)/);
  assert.match(page, /summary\.provider\.unknown/);
  assert.match(page, /summary\.provider\.error/);
});

test("contact UI remains present with CMS content and has explicit privacy consent", async () => {
  const [site, form, privacy] = await Promise.all([
    source("components/pastor-wood-site.tsx"),
    source("components/public-contact-form.tsx"),
    source("lib/public-contact-contract.ts"),
  ]);
  assert.match(site, /cmsPage\?\.sections\?\.length \? <CmsPageSections[\s\S]*?<ContactSection \/>[\s\S]*?<PublicContactForm/);
  assert.match(form, /name="category"/);
  assert.match(form, /name="consent"/);
  assert.match(form, /role="status" aria-live="polite"/);
  assert.match(form, /privacy-terms-conditions/);
  assert.match(privacy, /CONTACT_CONSENT_TEXT/);
  assert.match(site, /does not store the raw IP address or raw browser identifier/);
});

test("protected inbox includes list detail status export and safe states", async () => {
  const [navigation, list, detail, status, exportRoute, loading, error] = await Promise.all([
    source("lib/navigation.ts"),
    source("app/(private)/content/inbox/page.tsx"),
    source("app/(private)/content/inbox/[messageId]/page.tsx"),
    source("app/api/admin/contact-messages/status/route.ts"),
    source("app/api/admin/contact-messages/export/route.ts"),
    source("app/(private)/content/inbox/loading.tsx"),
    source("app/(private)/content/inbox/error.tsx"),
  ]);
  assert.match(navigation, /href: "\/content\/inbox"/);
  assert.match(list, /No contact messages match these filters/);
  assert.match(detail, /Notification detail/);
  assert.match(status, /requireContentManagerApiUser/);
  assert.match(exportRoute, /requireContentManagerApiUser/);
  assert.doesNotMatch(exportRoute, /ip_hash|user_agent_hash/);
  assert.match(loading, /ConsoleRouteLoading/);
  assert.match(error, /ConsoleRouteError/);
});

test("trusted giving controls remain present even when CMS sections exist", async () => {
  const [site, safety] = await Promise.all([
    source("components/pastor-wood-site.tsx"),
    source("lib/public-donation.ts"),
  ]);
  assert.match(site, /cmsPage\?\.sections\?\.length \? <CmsPageSections[\s\S]*?<section className="pw-section pw-donate-panel">/);
  assert.match(site, /getPublicDonorDashboardUrl/);
  assert.match(safety, /givewp-route=donation-form-view&form-id=14759/);
  assert.match(safety, /PASTORWOOD_DONOR_DASHBOARD_ALLOWED_HOSTS/);
});
