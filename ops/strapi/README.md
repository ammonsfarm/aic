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
- Backups: `/mnt/storage/backups/aic-strapi`, with exactly two PostgreSQL
  custom archives plus the Strapi media tar in each timestamped set
- PostgreSQL clients: native version 16 tools at `/usr/lib/postgresql/16/bin`

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

`ensure-strapi-schema.sh` and `backup-strapi.sh` are internal commands, not
standalone operator entry points. The supported `with-aic-db-env.sh` wrapper
replaces inherited database and libpq routing values, generates a fresh
PID-bound operation guard, and then executes them. Each internal command also
parses `/mnt/storage/aic/.env` independently without sourcing it and compares
the host, port, database name, user, password, and `aic_strapi` schema before it
can connect. The alternate comparison-file path exists only for isolated tests:
it requires `NODE_ENV=test`, fake native-client mode, and a non-production stub
client directory. It is rejected when `NODE_ENV` is unset, development, or
production.

The dedicated schema prevents Strapi migrations and tables from being mixed
into `public`; it is not a PostgreSQL authorization boundary. The explicit
deployment requirement reuses the existing `DB_USER` and its existing database
privileges. The schema initializer verifies that `aic_strapi` is owned by that
user and removes `PUBLIC` schema access, but it does not and cannot reduce the
login role's permissions on other AIC schemas.

Schema preparation runs in a short-lived oneshot unit. All PostgreSQL access
uses the canonical environment and native version-pinned clients.

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
5. Verify `/usr/lib/postgresql/16/bin/psql`, `pg_dump`, and `pg_restore` report
   PostgreSQL 16. The operations scripts reject any alternate production path.
6. Run the no-write client check with
   `STRAPI_BACKUP_DRY_RUN=1 /usr/local/libexec/aic-strapi/with-aic-db-env.sh
   /usr/local/libexec/aic-strapi/backup-strapi.sh`. It validates the canonical database variables
   and pinned native clients, but connects to no database and creates no backup
   directory.
7. Run `sudo /usr/local/libexec/aic-strapi/install-strapi-service.sh`. It installs the Strapi,
   schema-preparation, backup-service, and backup-timer units,
   prepares only the dedicated `aic_strapi` schema as `ammonsfarm`, starts the
   private service, leaves the enabled backup timer inactive until acceptance,
   verifies loopback-only binding and health, and
   safely configures the AIC server token.
8. Run `sudo systemctl start aic-strapi-backup.service` once and inspect its
   journal and output directory.
9. Run `sudo /usr/local/libexec/aic-strapi/verify-strapi-backup.sh`. It checks SHA-256 sums,
   re-lists both PostgreSQL archives without network access, compares their
   stored listings and exact object inventories, fully parses both archives to
   `/dev/null`, and never creates or restores a database.

Do not expose the Strapi write token or draft APIs through a public browser.

## Backup verification

Each successful backup contains exactly these PostgreSQL 16 custom archives:

- `aic-strapi-schema.dump`, selected only with `--schema=aic_strapi` and no
  table selector.
- `public-operational.dump`, selected only with one explicit `--table` option
  for each approved table and sequence and no schema selector.

The public operational inventory is deliberately narrow. Its 11 tables are
`public_subscriptions`, `public_subscription_attempts`,
`public_subscription_events`, `public_subscription_provider_outbox`,
`public_subscription_provider_webhook_events`, `public_contact_messages`,
`public_contact_attempts`, `public_contact_message_events`,
`pastorwood_public_projection`, `pastorwood_public_projection_identities`, and
`pastorwood_public_projection_media`. Its six sequences are
`public_subscriptions_id_seq`, `public_subscription_attempts_id_seq`,
`public_subscription_events_id_seq`, `public_contact_messages_id_seq`,
`public_contact_attempts_id_seq`, and `public_contact_message_events_id_seq`.
The installed `backup-object-inventory.txt` is the machine-checked source for
that exact list.

The backup command starts one canonical PostgreSQL session with a read-only
`REPEATABLE READ` transaction and `pg_export_snapshot()`. The session remains
open while both independent `pg_dump` processes receive that same snapshot ID.
The coordinated root wrapper stops Strapi before this begins and does not
restart it until both dumps and `media.tar.gz` finish, so the `aic_strapi`
archive and media tree stay quiesced together. The public web application is
not stopped: subscription, contact, and projection writes can continue, while
the public archive represents their state at the exported snapshot.

The manifest records the exact canonical source host, port, database name,
`aic_strapi` schema, snapshot ID and transaction properties, archive names,
and fully qualified table/sequence inventory. Creation and verification run
`pg_restore --list`, enforce the exact relation TOCs, and fully parse both
archives with `pg_restore --file=/dev/null`. They validate the media archive
with `tar --list`, checksum every archive, listing, and manifest, and only then
atomically name the backup directory.

The scripts deliberately run the installed PostgreSQL 16 `pg_dump` and
`psql`, `pg_dump`, and `pg_restore` binaries by absolute path. Backup creation
connects only through the exact canonical wrapper and PID-bound guard.
Verification lists and fully parses the completed archives offline without a
database target. Neither checked-in script creates, copies, clones, repoints,
or restores a database. The coordinated backup service restarts Strapi even
when snapshot export, either dump, media packaging, or validation fails; failed
runs also roll back the snapshot session and remove the partial directory.

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
