# Pastor Wood content service

This Strapi application is the structured content backend for the public Pastor
Wood site and the authenticated AIC content-manager tools. It is versioned with
the AIC application so schema, editor, and public-rendering changes can be
reviewed and deployed together.

## Content model

| Collection | Purpose |
| --- | --- |
| `pages` | Flexible public pages and reusable section layouts |
| `posts` | Devotionals, Bible studies, articles, written resources, and newsletter archives |
| `episodes` | Podcast/radio metadata, audio, guests, scripture, and processing state |
| `people` | Board members, authors, guests, and staff |
| `endorsements` | Public quotes, attribution, ordering, and source links |
| `media-assets` | Governed media records with rights, attribution, checksum, and visibility |
| `redirects` | Explicit legacy and editorial URL redirects |
| `editorial-revisions` | Append-only content snapshots used for rollback |
| `editorial-events` | Append-only actor and workflow audit history |

All public editorial collections use draft-and-publish. A media record defaults
to `private`; public code also requires the record to be published and its
visibility to be `public`.

## Editorial workflow API

The AIC editor uses the custom `/api/editorial-workflow` routes to keep a
revision snapshot and audit event with every managed mutation:

- `POST /api/editorial-workflow/:collection` creates a draft.
- `PUT /api/editorial-workflow/:collection/:documentId` saves a revision.
- `POST /api/editorial-workflow/:collection/:documentId/:action` runs
  `publish`, `unpublish`, `archive`, `restore`, `rollback`, or `delete`.
- `GET /api/editorial-workflow/:collection/:documentId/revisions` reads the
  immutable revision history.

The actor is required. Rollback creates a new current revision; it never edits
old revision or audit rows in place. The AIC service token must be scoped to the
editorial workflow, upload, and required collection read/write permissions. Do
not grant the token Strapi super-admin access and never expose it to the browser.

## Local development

Copy `.env.example` to an untracked `.env`, generate unique application secrets,
then run:

```bash
npm ci
npm run develop
```

SQLite is allowed only for local development. Production requires PostgreSQL
and refuses to boot without the database environment variables. Validate the
service with:

```bash
npm test
npm run build
```

## Production operations

The native service, durable upload, and schema-scoped backup contract lives in
`../../ops/strapi/README.md`. Those artifacts are intentionally not installed by
this source tree.

Before launch, operations must run the checked-in provisioning and service
installers, verify a real schema-scoped archive and its checksums without a
database restore, run the controlled legacy import, and complete an authenticated
content-manager acceptance pass. The service
bootstrap maintains a custom least-privilege AIC token and revokes Strapi's broad
first-run defaults.

## Legacy import boundary

Do not scan or import the 92 GB WordPress backup as a media library. Only the
vetted 2,869-attachment manifest may seed legacy media records. Preserve the
attachment ID/path/checksum fields during a later controlled import and keep
private operational subtrees excluded.
