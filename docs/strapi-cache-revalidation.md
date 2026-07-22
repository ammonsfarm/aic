# Strapi Cache Revalidation

Public Pastor Wood pages that read Strapi content use Next.js server-side caching. They are not live Strapi API calls on every visitor page load.

## Environment

Set these values on the AIC web app host:

```text
STRAPI_URL=https://your-strapi-host
STRAPI_API_TOKEN=...
STRAPI_REVALIDATE_SECRET=...
STRAPI_PAGE_REVALIDATE_SECONDS=3600
```

`STRAPI_REVALIDATE_SECRET` must be a random shared secret known only to Strapi and the AIC app.

## Strapi Webhook

Configure a Strapi webhook for entry publish, unpublish, and delete events:

```text
POST https://pastorwood.org/api/revalidate/strapi
Authorization: Bearer <STRAPI_REVALIDATE_SECRET>
Content-Type: application/json
```

The webhook must send the normal Strapi `event` value. Draft create/update events are acknowledged without invalidating public caches. For publication lifecycle events, `entry.pageKey` or `entry.slug` narrows revalidation to that public page. A generic publication payload revalidates all known Strapi-backed Pastor Wood public pages.

## Behavior

- Normal visitors are served cached/static Next.js output.
- Strapi is read when the cache is cold, after the configured revalidate window, or after the webhook invalidates the cache.
- If Strapi is unavailable, public pages continue to use the existing safe fallback behavior.
