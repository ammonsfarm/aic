# CONTRIBUTING_AI.md

## Project Purpose

This Strapi app is the content management backend spike for the Jim Wood / Abiding in Christ public website.

The existing Next.js public site remains outside this app at:

```text
/Users/van/firebase/aic
```

Use this app for Strapi-specific content schemas, admin configuration, PostgreSQL-backed editorial content, media uploads, roles, permissions, and API configuration.

## Boundaries

- Do not move the public website frontend into Strapi.
- Do not edit `/Users/van/firebase/aic` unless the task explicitly asks for cross-project integration.
- Do not commit `.env`, real credentials, API tokens, database passwords, generated JWT secrets, app keys, transfer token salts, or upload provider credentials.
- Keep Strapi media local for the first spike unless production storage is explicitly requested.
- Prefer built-in Strapi features before custom plugins, controllers, or admin UI.

## Current Spike Direction

The first useful target is a small, working Strapi baseline:

1. Local Strapi starts successfully.
2. PostgreSQL is the configured database.
3. Admin setup can create the first admin user.
4. Content types are added in focused follow-up changes.
5. The AIC Next.js app can later fetch published content for `/about-pastor-wood` and `/contact`.

See `docs/jimwood-setup.md` in this app and `../STRAPI_JIMWOOD_PROJECT_PLAN.md` in the workspace root.
