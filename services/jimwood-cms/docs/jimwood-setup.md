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

## First Admin User

On the first successful `npm run develop`, open the admin URL printed by Strapi and create the first admin user.

This user is local to Strapi. It does not replace the AIC Next.js app authentication model.

## Current Scope

This baseline intentionally does not define all Jim Wood content types yet. Add them in focused changes:

1. Site Settings single type.
2. Page collection type with Draft & Publish.
3. Page section components or dynamic zone.
4. Post / Writing, Episode, Person, Endorsement, and Newsletter types.
5. Public API permissions and AIC Next.js fetch integration.
