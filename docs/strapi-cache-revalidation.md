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

Configure a Strapi webhook for page publish/update events:

```text
POST https://pastorwood.org/api/revalidate/strapi
Authorization: Bearer <STRAPI_REVALIDATE_SECRET>
Content-Type: application/json
```

The webhook may send the normal Strapi event payload. If the payload contains `entry.pageKey` or `entry.slug`, the AIC app revalidates that public page and the related Strapi cache tags. If the payload is generic, the AIC app revalidates all known Strapi-backed Pastor Wood public pages.

## Behavior

- Normal visitors are served cached/static Next.js output.
- Strapi is read when the cache is cold, after the configured revalidate window, or after the webhook invalidates the cache.
- If Strapi is unavailable, public pages continue to use the existing safe fallback behavior.
