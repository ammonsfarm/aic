# Pastor Wood Strapi production service

This directory contains the native systemd and backup artifacts for the versioned
Strapi service in `services/jimwood-cms`. They intentionally do not install or
restart anything by themselves.

## Runtime contract

- Service user: `ammonsfarm`
- Bind address: `127.0.0.1:1337`
- Source: `/mnt/storage/aic/services/jimwood-cms`
- Generated Strapi application secrets: `/etc/aic/strapi.env` (root-owned,
  mode 0600, and contains no database target or credentials)
- Database source: the existing `/mnt/storage/aic/.env` `DB_HOST`, `DB_PORT`,
  `DB_NAME`, `DB_USER`, and `DB_PASSWORD` values
- Pinned production target: `192.168.1.106:5432`; startup fails if the canonical
  environment points anywhere else
- Secrets recovery copy: `/mnt/storage/backups/aic-strapi-secrets` (root-only,
  checksummed, and separate from service-user database/media backups)
- Database namespace: dedicated schema `aic_strapi` inside that same existing
  AIC PostgreSQL database; no local or copied Strapi database
- Durable new uploads: `/mnt/storage/pastorwood-media/strapi/uploads`
- Backups: `/mnt/storage/backups/aic-strapi`
- PostgreSQL backup client: local Docker image `postgres:16` with `--pull=never`

The service stays private to the host. Content managers use the authenticated AIC
`/content` tools. A Strapi super administrator can use an SSH port forward when
direct admin access is required.

## Required environment

`provision-strapi.sh` creates `/etc/aic/strapi.env` with independent random
application secrets and locks it to root mode 0600. It never generates, copies,
or stores database credentials. `with-aic-db-env.sh` reads the canonical AIC
environment at command start, maps its `DB_*` values to Strapi's `DATABASE_*`
variables, removes `DATABASE_URL`, and pins `DATABASE_SCHEMA=aic_strapi`.
The service prepares only that schema as the unprivileged `ammonsfarm` user
before Strapi starts; no root process sources the application-owned AIC
environment. It does not create a role or database. Provisioning also maintains
a checksummed, root-only recovery copy of the application secrets on
`/mnt/storage`.

The dedicated schema prevents Strapi migrations and tables from being mixed
into `public`; it is not a PostgreSQL authorization boundary. The explicit
deployment requirement reuses the existing `DB_USER` and its existing database
privileges. The schema initializer verifies that `aic_strapi` is owned by that
user and removes `PUBLIC` schema access, but it does not and cannot reduce the
login role's permissions on other AIC schemas.

Schema preparation runs in a short-lived oneshot unit. The long-running Strapi
unit cannot see `/run/docker.sock` or `/var/run/docker.sock`, even when the
service account belongs to the host's Docker group.

At service bootstrap, Strapi creates or reconciles one custom least-privilege
token for the AIC server. Its key is written only to the mode-0600 runtime file
`/run/aic-strapi/aic-api-token`; Strapi's broad first-run Full Access and Read
Only tokens are revoked. `sync-aic-strapi-env.sh` copies the managed key into the
existing mode-0600 AIC service environment without printing it. Never put token
values in Git or command arguments.

Production refuses to start with SQLite.

## Install after branch integration

1. Confirm `/mnt/storage/aic/.env` has the existing AIC PostgreSQL `DB_*`
   settings. Do not copy, restore, or repoint the database.
2. Copy the small operations installer to a root-owned path, then use it to
   install immutable service scripts and unit sources:
   `sudo install -o root -g root -m 0755 ops/strapi/install-strapi-ops.sh
   /usr/local/sbin/aic-install-strapi-ops && sudo
   /usr/local/sbin/aic-install-strapi-ops`.
3. Run `sudo /usr/local/libexec/aic-strapi/provision-strapi.sh` to create the private application
   secrets. It does not connect to PostgreSQL.
4. From `/mnt/storage/aic`, run `npm --prefix services/jimwood-cms ci` and
   `NODE_ENV=production /usr/local/libexec/aic-strapi/with-aic-db-env.sh npm --prefix
   services/jimwood-cms run build` as `ammonsfarm`.
5. Install and inspect the backup client image explicitly with
   `docker pull postgres:16` and `docker image inspect postgres:16`. The backup
   job never pulls an image on its own.
6. Run the no-write client check with
   `STRAPI_BACKUP_DRY_RUN=1 /usr/local/libexec/aic-strapi/with-aic-db-env.sh
   /usr/local/libexec/aic-strapi/backup-strapi.sh`. It validates the canonical database variables
   and pinned client image, but connects to no database and creates no backup
   directory.
7. Run `sudo /usr/local/libexec/aic-strapi/install-strapi-service.sh`. It installs the Strapi,
   schema-preparation, backup-service, and backup-timer units,
   prepares only the dedicated `aic_strapi` schema as `ammonsfarm`, starts the
   private service and timer, verifies loopback-only binding and health, and
   safely configures the AIC server token.
8. Run `sudo systemctl start aic-strapi-backup.service` once and inspect its
   journal and output directory.
9. Run `sudo /usr/local/libexec/aic-strapi/verify-strapi-backup.sh`. It checks SHA-256 sums,
   re-lists the PostgreSQL archive without network access, compares both stored
   archive listings, and never creates or restores a database.

Do not expose the Strapi write token or draft APIs through a public browser.

## Backup verification

Each successful backup contains a PostgreSQL custom-format dump scoped with
`pg_dump --schema aic_strapi`, a media archive, file listings, metadata, and
SHA-256 checksums. The backup command validates the database archive with
`pg_restore --list` and a full offline `pg_restore --file=/dev/null`, validates
the media archive with `tar --list`, checksums the archives and listings, and
only then atomically names the backup directory.

The farm host's `pg_dump` and `pg_restore` wrappers are not usable without a
versioned client package, so the scripts deliberately run both tools from the
already-installed `postgres:16` image. Backup creation uses host networking only
for the schema-scoped dump. Verification uses `--network none`, mounts the
completed backup read-only, and lists the archive without a database target.
Neither checked-in script creates a validation database or invokes a restore.
The coordinated backup service temporarily stops Strapi, runs the database and
media backup as `ammonsfarm`, and restarts Strapi even when backup creation
fails. This prevents a successful archive from pairing database metadata with a
different point-in-time media tree.

The configured backup directory and media root are currently on the same
`/mnt/storage` failure domain. An independently configured off-host or offsite
copy remains required for storage-loss recovery; the checked-in scripts do not
claim that same-host retention provides it.

## Legacy media boundary

The 92 GB WordPress backup is not a public media root and must never be imported
wholesale. Only the vetted 2,869-attachment manifest and WordPress attachment
metadata may create Strapi media records. Operational subtrees such as
`gravity_forms`, `woocommerce_uploads`, and logs remain private and excluded.
New Strapi media records default to `visibility=private`; public rendering also
requires a published record with `visibility=public`.
