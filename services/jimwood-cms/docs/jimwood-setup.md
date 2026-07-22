# Jim Wood Strapi Setup

This app is the Strapi CMS baseline for the Jim Wood / Abiding in Christ public site.

The workspace also contains the upstream Strapi source checkout in `../strapi`. This app lives in `jimwood-cms` so the generated project does not overwrite the planning documents or the upstream source checkout.

## Local Environment

Create a local `.env` from the committed placeholder file:

```bash
cp .env.example .env
```

Replace all `replace_me_*` values before using the app for real editorial content. The generated `.env` file is ignored by git.

## PostgreSQL

The app is configured for PostgreSQL through `config/database.ts` and the `DATABASE_*` environment variables.

For local development, start the included PostgreSQL container:

```bash
docker compose up -d postgres
```

Then start Strapi:

```bash
npm run develop
```

The initial local defaults are:

```text
DATABASE_CLIENT=postgres
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5432
DATABASE_NAME=jimwood_strapi
DATABASE_USERNAME=strapi
```

`DATABASE_PASSWORD` should stay in `.env` only.

## Administrative access

The production service binds only to `127.0.0.1`. Content managers work through
the Clerk-protected AIC `/content` area, which uses a generated custom Strapi API
token. Strapi's broad default first-run tokens are revoked automatically.

If emergency Strapi super-admin access is ever required, create that separate
local account only through an SSH port forward. It does not replace the AIC
Next.js authentication model.

## Current scope

The versioned service defines Site Settings, Pages and page sections, Posts,
Episodes, People, Endorsements, governed Media Assets, Redirects, Editorial
Revisions, and Editorial Events. The protected AIC editor owns create, save,
preview, publish, unpublish, archive, restore, rollback, and audit workflows.

Production provisioning, service installation, backups, and restore drills are
documented in `../../../ops/strapi/README.md`.
