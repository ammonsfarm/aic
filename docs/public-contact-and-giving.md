# Public contact and giving continuity

## Giving destinations

The built-in donation destination is the verified GiveWP route:

```text
https://www.pastorwood.org/?givewp-route=donation-form-view&form-id=14759
```

PastorWood-hosted donation links must match that route and form ID exactly. A replacement payment provider must use HTTPS and its hostname must be listed in `PASTORWOOD_DONATION_ALLOWED_HOSTS`. `PASTORWOOD_DONATION_URL` can then select a URL on that host.

The donor account service is configured independently with `PASTORWOOD_DONOR_DASHBOARD_URL` and `PASTORWOOD_DONOR_DASHBOARD_ALLOWED_HOSTS`. Allowlisting a giving host does not allow it to serve the dashboard, or vice versa. The same values are editable through the revisioned Strapi site-settings workflow. Invalid CMS or environment values fall back to the built-in destinations.

The trusted giving/dashboard panel remains on its public page even when the page has CMS sections. CTA URLs inside those sections use the same purpose-specific validation.

## Contact capture

`POST /api/public/contact` accepts same-site JSON only. It applies a streamed 16 KiB body limit, strict field and consent validation, a honeypot, keyed rate-limit fingerprints, and per-IP/per-sender advisory locks. It stores messages in PostgreSQL through migration `024_public_contact_messages.sql`; Strapi is not in this request path.

The contact form does not store raw IP addresses or raw user-agent values. It stores keyed SHA-256 hashes using `CONTACT_RATE_LIMIT_SECRET`, with `CLERK_SECRET_KEY` as the configured production fallback. Public responses never include hashes or internal message identifiers.

Abuse-attempt records are eligible for bounded cleanup after 30 days. Messages must first be archived in the protected inbox; archived messages are eligible for bounded cleanup after 365 days. The hourly `aic-public-data-retention-worker.timer` applies those bounded deletions even when no one submits a new form; request-time cleanup remains a supplemental safeguard.

## Inbox and notification truth

Administrators and Content Managers can use `/content/inbox` to filter messages, open private details, update the audited workflow status, and export a private CSV. Neither the UI nor the CSV exposes request fingerprints.

This repository has no configured mail-delivery adapter. New messages therefore use `notification_status = 'not_configured'` and remain durably available in the protected inbox. The public response confirms receipt and storage, not email delivery. A future provider integration must update the durable notification status rather than inferring delivery from configuration alone.

## Required rollout order

1. Set `CONTACT_RATE_LIMIT_SECRET` and any approved giving/dashboard allowlists in the existing server environment.
2. Apply the normal PostgreSQL migrations to the existing configured database.
3. Build and deploy Strapi so the separate donor-dashboard site-setting field is available.
4. Build and deploy the Next.js service.
5. Verify public contact submission, inbox visibility, status audit, CSV export, both external giving links, and mobile/keyboard behavior in the deployed browser surface.
