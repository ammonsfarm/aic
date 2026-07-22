# Pastor Wood Strapi production service

This directory contains the native systemd and backup artifacts for the versioned
Strapi service in `services/jimwood-cms`. They intentionally do not install or
restart anything by themselves.

## Runtime contract

- Service user: `ammonsfarm`
- Bind address: `127.0.0.1:1337`
- Source: `/mnt/storage/aic/services/jimwood-cms`
- Secrets: `/etc/aic/strapi.env` (root-owned, mode 0600)
- Database: a separate PostgreSQL database, never the AIC application schema
- Durable new uploads: `/mnt/storage/pastorwood-media/strapi/uploads`
- Backups: `/mnt/storage/backups/aic-strapi`
- PostgreSQL backup client: local Docker image `postgres:16` with `--pull=never`

The service stays private to the host. Content managers use the authenticated AIC
`/content` tools. A Strapi super administrator can use an SSH port forward when
direct admin access is required.

## Required environment

Copy the placeholder keys from `services/jimwood-cms/.env.example` into
`/etc/aic/strapi.env`, generate independent random secrets, and set PostgreSQL
credentials. Also set AIC's `STRAPI_URL=http://127.0.0.1:1337` and a scoped API
token. Never put token values in Git.

Production refuses to start with SQLite.

## Install after branch integration

1. Create the separate PostgreSQL database and least-privilege Strapi role.
2. Run `npm ci && npm run build` in `services/jimwood-cms`.
3. Install and inspect the backup client image explicitly with
   `docker pull postgres:16` and `docker image inspect postgres:16`. The backup
   job never pulls an image on its own.
4. Run the no-write client check with
   `STRAPI_BACKUP_DRY_RUN=1 ops/strapi/backup-strapi.sh`. It still reads the
   configured environment file and requires the database variables, but it
   connects to no database and creates no backup directory.
5. Install the three unit files from `ops/strapi/systemd` into
   `/etc/systemd/system`.
6. Run `systemctl daemon-reload`.
7. Enable and start `aic-strapi.service`.
8. Verify `curl -fsS http://127.0.0.1:1337/_health`.
9. Run `aic-strapi-backup.service` once manually and inspect its journal.
10. Enable `aic-strapi-backup.timer`.

Do not expose the Strapi write token or draft APIs through a public browser.

## Backup verification and restore drill

Each successful backup contains a PostgreSQL custom-format dump, a media archive,
file listings, metadata, and SHA-256 checksums. The backup command validates both
archives before atomically naming the backup directory.

The farm host's `pg_dump` and `pg_restore` wrappers are not usable without a
versioned client package, so the script deliberately runs both tools from the
already-installed `postgres:16` image. It uses host networking only for the dump,
mounts only the in-progress backup directory, passes the password through the
container environment rather than command arguments, drops capabilities, and
runs with a read-only container filesystem and the service user's UID/GID.

A restore drill must be performed into a disposable PostgreSQL database and a
temporary media directory before launch and at least quarterly. Never restore over
the live database or uploads directory. Use `pg_restore --clean` only against
that explicitly created disposable database.

## Legacy media boundary

The 92 GB WordPress backup is not a public media root and must never be imported
wholesale. Only the vetted 2,869-attachment manifest and WordPress attachment
metadata may create Strapi media records. Operational subtrees such as
`gravity_forms`, `woocommerce_uploads`, and logs remain private and excluded.
New Strapi media records default to `visibility=private`; public rendering also
requires a published record with `visibility=public`.
