# Public contact and giving continuity

## Giving destinations

The former GiveWP destination is retained only as a rejected legacy reference:

```text
https://www.pastorwood.org/?givewp-route=donation-form-view&form-id=14759
```

After cutover, every `pastorwood.org` giving URL is a self-link and is invalid. A payment provider must use HTTPS and its hostname must be listed in `PASTORWOOD_DONATION_ALLOWED_HOSTS`. `PASTORWOOD_DONATION_URL` can then select a URL on that external host.

The donor account service is configured independently with `PASTORWOOD_DONOR_DASHBOARD_URL` and `PASTORWOOD_DONOR_DASHBOARD_ALLOWED_HOSTS`. Allowlisting a giving host does not allow it to serve the dashboard, or vice versa. The same values are editable through the revisioned Strapi site-settings workflow. Empty, invalid, or PastorWood-hosted values fail closed and leave the corresponding public control unavailable.

The trusted giving/dashboard panel remains on its public page even when the page has CMS sections. CTA URLs inside those sections use the same purpose-specific validation.

## Contact capture

`POST /api/public/contact` accepts same-site JSON only. It applies a streamed 16 KiB body limit, strict field and consent validation, a honeypot, keyed rate-limit fingerprints, and per-IP/per-sender advisory locks. It stores messages in PostgreSQL through migration `024_public_contact_messages.sql`; Strapi is not in this request path.

The contact form does not store raw IP addresses or raw user-agent values. It stores keyed SHA-256 hashes using `CONTACT_RATE_LIMIT_SECRET`, with `CLERK_SECRET_KEY` as the configured production fallback. Public responses never include hashes or internal message identifiers.

Abuse-attempt records are eligible for bounded cleanup after 30 days. Messages must first be archived in the protected inbox; archived messages are eligible for bounded cleanup after 365 days. The hourly `aic-public-data-retention-worker.timer` applies those bounded deletions even when no one submits a new form; request-time cleanup remains a supplemental safeguard.

## Inbox and notification truth

Administrators and Content Managers can use `/content/inbox` to filter messages, open private details, update the audited workflow status, and export a private CSV. Neither the UI nor the CSV exposes request fingerprints. The existing notification state, detail, notified timestamp, and audited message history explain whether delivery is not configured, queued or retrying, accepted by SMTP, or terminally failed.

SMTP delivery is disabled by default. While `CONTACT_EMAIL_DELIVERY_ENABLED=false`, or while any required SMTP setting is absent or invalid, accepted messages use `notification_status = 'not_configured'`, create no impossible outbox work, and remain durably available in the protected inbox. The public response confirms receipt and storage, never email delivery.

To enable delivery, set all of these values in the canonical `/mnt/storage/aic/.env`: `CONTACT_EMAIL_DELIVERY_ENABLED`, `CONTACT_EMAIL_SMTP_HOST`, `CONTACT_EMAIL_SMTP_PORT`, `CONTACT_EMAIL_SMTP_USERNAME`, `CONTACT_EMAIL_SMTP_PASSWORD`, `CONTACT_EMAIL_SMTP_STARTTLS`, `CONTACT_EMAIL_FROM`, and one plain-mailbox `CONTACT_EMAIL_TO`. STARTTLS is required for remote hosts; plaintext SMTP is accepted only for a loopback relay. Do not place credentials in systemd unit files.

When the gate and complete configuration are ready, contact capture inserts the message, received event, and `public_contact_notification_outbox` row in one PostgreSQL statement. `aic-contact-email-worker.timer` claims work with `SKIP LOCKED`, uses bounded exponential retry, recovers stale claims, stops after eight unsuccessful attempts, and writes provider-result events plus truthful `notification_status` and `notification_detail`. SMTP acceptance means the configured server accepted the message for delivery; it does not prove recipient delivery. Recovery is intentionally at-least-once, with a stable per-contact `Message-ID` to help downstream duplicate suppression after an interrupted attempt.

## Required rollout order

1. Set `CONTACT_RATE_LIMIT_SECRET` and any approved giving/dashboard allowlists in the existing server environment.
2. Leave contact email disabled until an SMTP account, sender, and destination are approved; then add the complete contract above to the canonical environment.
3. Apply the normal PostgreSQL migrations to the existing configured database.
4. Build and deploy Strapi so the separate donor-dashboard site-setting field is available.
5. Build and deploy the Next.js service; the deploy path installs the contact-email timer only when its gate and full configuration pass readiness checks.
6. Verify public contact submission, inbox visibility, status audit, CSV export, both external giving links, and mobile/keyboard behavior in the deployed browser surface. When email is enabled, also verify the timer and one provider acceptance without exposing message content or credentials in logs.
