# Jim Wood Strapi Setup

This app is the Strapi CMS baseline for the Jim Wood / Abiding in Christ public site.

The workspace also contains the upstream Strapi source checkout in `../strapi`. This app lives in `jimwood-cms` so the generated project does not overwrite the planning documents or the upstream source checkout.

## Local Environment

Create a local `.env` from the committed placeholder file:

```bash
cp .env.example .env
```

Replace all `replace_me_*` values before using the app for real editorial content. The generated `.env` file is ignored by git.

## Local database

Local development defaults to Strapi's SQLite database in `.tmp/data.db` and
does not require a separate database service. This disposable empty developer
database is never copied from, restored from, or substituted for production.

Start Strapi directly:

```bash
npm run develop
```

The initial local defaults are:

```text
DATABASE_CLIENT=sqlite
DATABASE_FILENAME=.tmp/data.db
```

Developers who intentionally use a native local PostgreSQL installation can
set the documented `DATABASE_*` values in their ignored `.env`; production
settings must never be copied into local development.

Production does not use this local database. The native service maps the
existing AIC `DB_*` target from `/mnt/storage/aic/.env` and routes
Strapi-managed objects to the `aic_strapi` schema in that same database.
Production startup rejects SQLite, alternate endpoints, independent libpq
routing, and direct schema/backup commands outside the canonical wrapper.
Because production intentionally reuses the existing AIC database login, this
schema is a namespace boundary rather than a separate authorization role.

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

Production provisioning, service installation, and non-restoring backup checks are
documented in `../../../ops/strapi/README.md`.
