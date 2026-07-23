# Strapi Cache Revalidation

Public Pastor Wood pages that read Strapi content use Next.js server-side caching. They are not live Strapi API calls on every visitor page load.

## Production environment

The production web app reads Strapi settings only from the canonical `/mnt/storage/aic/.env` file:

```text
STRAPI_URL=http://127.0.0.1:1337
STRAPI_API_TOKEN=...
STRAPI_REVALIDATE_SECRET=...
STRAPI_PAGE_REVALIDATE_SECONDS=3600
```

Provisioning creates `STRAPI_REVALIDATE_SECRET` as 64 lowercase hexadecimal characters in the root-owned `/etc/aic/strapi.env`. The root environment-sync operation copies that value into the canonical AIC environment under an exclusive lock and an atomic rename. It byte-compares the exact existing `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` lines before and after the rewrite and refuses any change to them. The secret and management token are never printed.

Publication automation does not accept a revalidation URL from environment variables. The scheduled worker and reviewed cutover tool send a signed generic publication event only to the local web listener at `http://127.0.0.1:8087/api/revalidate/strapi`. Success requires both a 2xx response and JSON containing `"revalidated": true`; any other response is an error.

## Durable publication invalidation

Before every scheduled publication request, the worker fsyncs a mode-0600 pending marker in `/var/lib/aic-scheduled-publication`. Flushers are serialized with a host file lock, atomically claim the marker as `.inflight`, and remove it only after the local route confirms invalidation. A process restart recovers an `.inflight` marker. A marker written while a request is in flight is processed in the same flush loop, and a zero-publication timer run retries old work before querying Strapi. The systemd state directory is private to `ammonsfarm`.

The reviewed PastorWood cutover records the same pending/complete state in its publication manifest, bound to the exact fingerprint of recorded publication actions. It persists `pending` before each remote publication or redirect activation. A resumed run must clear pending invalidation before making another publication change.

## Strapi Webhook

For publication changes made outside the custom AIC editor, scheduled worker, or reviewed cutover tool, configure a Strapi webhook for entry publish, unpublish, and delete events:

```text
POST https://pastorwood.org/api/revalidate/strapi
Authorization: Bearer <STRAPI_REVALIDATE_SECRET>
Content-Type: application/json
```

The webhook must send the normal Strapi `event` value. Draft create/update events are acknowledged without invalidating public caches. For publication lifecycle events, `entry.pageKey` or `entry.slug` narrows revalidation to that public page. A generic publication payload revalidates all known Strapi-backed Pastor Wood public pages. The webhook is complementary; local publication automation already performs durable signed invalidation.

## Behavior

- Normal visitors are served cached/static Next.js output.
- Strapi is read when the cache is cold, after the configured revalidate window, or after the webhook invalidates the cache.
- If Strapi is unavailable, public pages continue to use the existing safe fallback behavior.
- A publication command fails closed when cache invalidation cannot be confirmed. Its durable pending evidence remains for the next retry.
