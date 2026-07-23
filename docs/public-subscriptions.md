# Public devotional subscriptions

The public form stores the submitted email, the accepted consent text and version,
the consent time, and the source page. It stores keyed hashes of the request IP and
browser identifier rather than their raw values.

`public_subscription_attempts` supports rate limiting. Attempt rows are retained
for 30 days. Each subscription request removes at most 500 expired rows, ordered
oldest first, and migration `021_public_subscription_attempt_retention.sql` adds
the age index used by that bounded cleanup. When the form is idle, cleanup resumes
with the next request. The `accepted` column means the rate limiter admitted the
attempt; subscriber status remains authoritative in `public_subscriptions`.

A suppressed subscriber stays suppressed after another consent submission. The
attempt refreshes the recorded consent context and writes a
`resubscribe-blocked-suppressed` event, but the public API returns a generic
non-success response and does not echo the address or disclose internal status.

Unsubscribe links use a deterministic, signed opaque identifier. The email
address is never encoded into the URL. PostgreSQL stores only a SHA-256 hash of
the signed token; new consent captures populate it immediately and an authorized
subscriber export backfills or rotates hashes for older records. Keep
`SUBSCRIPTION_UNSUBSCRIBE_SECRET` stable and in the protected deployment backup,
because changing it intentionally invalidates previously exported links.
