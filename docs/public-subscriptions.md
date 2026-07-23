# Public devotional subscriptions

The public form stores the submitted email, the accepted consent text and version,
the consent time, and the source page. It stores keyed hashes of the request IP and
browser identifier rather than their raw values.

`public_subscription_attempts` supports rate limiting. Attempt rows are retained
for 30 days. Each subscription request removes at most 500 expired rows, ordered
oldest first, and migration `021_public_subscription_attempt_retention.sql` adds
the age index used by that bounded cleanup. The hourly
`aic-public-data-retention-worker.timer` enforces the same bounded deletion while
the form is idle; request-time cleanup remains a supplemental safeguard. The
`accepted` column means the rate limiter admitted the attempt; subscriber status
remains authoritative in `public_subscriptions`.

A suppressed subscriber stays suppressed after another consent submission. The
attempt refreshes the recorded consent context and writes a
`resubscribe-blocked-suppressed` event, but the public API returns a generic
non-success response and does not echo the address or disclose internal status.

## Mailchimp delivery and double opt-in

The legacy site already uses Mailchimp audience `9ad7bbba36`. New requests are
stored as `pending` and atomically queue a `subscribe` intent in
`public_subscription_provider_outbox`; the public response tells the visitor to
check email instead of claiming that delivery is already active. The systemd
timer runs `scripts/process_subscription_provider_outbox.py`, which requests
Mailchimp `pending` status so Mailchimp sends its confirmation flow. It uses a
generation counter and compare-and-set completion so an older in-flight action
cannot overwrite a newer unsubscribe or suppression request.

Mailchimp confirmation, unsubscribe, and cleaned-address events arrive at
`/api/webhooks/mailchimp`. Every delivery must carry Mailchimp's HMAC-SHA256
signature over the exact raw body and a timestamp no more than five minutes old.
The handler bounds the raw request body, requires the configured audience, and
deduplicates provider events before changing local status. A local suppression
always wins; if Mailchimp reports a suppressed address as subscribed, the app
queues an unsubscribe correction.

Provider failures use bounded exponential retry and become visible on
`/content/newsletters`. A content manager can requeue failed or exhausted rows;
the action and each provider failure are audited without logging an address,
credential, raw IP, or raw browser identifier. Configure these only in the
protected server environment:

- `MAILCHIMP_API_KEY`
- `MAILCHIMP_SERVER_PREFIX` (may be derived from the API-key suffix)
- `MAILCHIMP_AUDIENCE_ID` (required explicitly; there is no runtime fallback)
- `MAILCHIMP_WEBHOOK_SECRET` (the one-time signing secret shown when the webhook is created)
- `SUBSCRIPTION_RATE_LIMIT_SECRET`
- `SUBSCRIPTION_UNSUBSCRIBE_SECRET`
- `PASTORWOOD_SUBSCRIPTIONS_ENABLED` (must be exactly `true` to accept public requests)

Complete provider secrets never enable public capture by themselves. With the
runtime flag absent or false, the public API remains unavailable while existing
unsubscribe and reconciliation work can still finish. No code path prints secret
values.

Unsubscribe links use a deterministic, signed opaque identifier. The email
address is never encoded into the URL. PostgreSQL stores only a SHA-256 hash of
the signed token; new consent captures populate it immediately and an authorized
subscriber export backfills or rotates hashes for older records. Keep
`SUBSCRIPTION_UNSUBSCRIBE_SECRET` stable and in the protected deployment backup,
because changing it intentionally invalidates previously exported links.
