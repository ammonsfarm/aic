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

`provision-strapi.sh` creates `/etc/aic/strapi.env` with independent random
secrets, creates the isolated `aic_strapi` role/database in `farm-postgres`, and
locks the environment file to root mode 0600. It is idempotent and refuses
unexpected paths or database settings.

At service bootstrap, Strapi creates or reconciles one custom least-privilege
token for the AIC server. Its key is written only to the mode-0600 runtime file
`/run/aic-strapi/aic-api-token`; Strapi's broad first-run Full Access and Read
Only tokens are revoked. `sync-aic-strapi-env.sh` copies the managed key into the
existing mode-0600 AIC service environment without printing it. Never put token
values in Git or command arguments.

Production refuses to start with SQLite.

## Install after branch integration

1. Run `sudo ops/strapi/provision-strapi.sh` to create the private environment,
   PostgreSQL database, and least-privilege role.
2. Run `npm ci && npm run build` in `services/jimwood-cms` as `ammonsfarm`.
3. Install and inspect the backup client image explicitly with
   `docker pull postgres:16` and `docker image inspect postgres:16`. The backup
   job never pulls an image on its own.
4. Run the no-write client check with
   `STRAPI_BACKUP_DRY_RUN=1 ops/strapi/backup-strapi.sh`. It still reads the
   configured environment file and requires the database variables, but it
   connects to no database and creates no backup directory.
5. Run `sudo ops/strapi/install-strapi-service.sh`. It installs all three units,
   starts the private service and timer, verifies loopback-only binding and
   health, and safely configures the AIC server token.
6. Run `sudo systemctl start aic-strapi-backup.service` once and inspect its
   journal and output directory.
7. Run `sudo ops/strapi/restore-drill.sh`; it restores only into a generated
   disposable database and temporary media directory, verifies contents, and
   removes both drill targets.

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
temporary media directory before launch and at least quarterly. Never restore
over the live database or uploads directory. The checked-in drill intentionally
does not accept a database name and never uses `pg_restore --clean`.

## Legacy media boundary

The 92 GB WordPress backup is not a public media root and must never be imported
wholesale. Only the vetted 2,869-attachment manifest and WordPress attachment
metadata may create Strapi media records. Operational subtrees such as
`gravity_forms`, `woocommerce_uploads`, and logs remain private and excluded.
New Strapi media records default to `visibility=private`; public rendering also
requires a published record with `visibility=public`.
