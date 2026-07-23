# AIC Postgres Serving Database

This folder contains the Postgres/pgvector serving schema and sync tooling for the AIC podcast RAG project.

SQLite remains a local staging/audit source for historical import tools. It is
not a PostgreSQL copy or substitute. The only server database target is the
existing PostgreSQL service at `192.168.1.106:5432`, using the database name and
credentials in `/mnt/storage/aic/.env`.

## Setup

Install Python dependencies in an isolated environment:

```bash
python3 -m venv .venv-pg
.venv-pg/bin/python -m pip install -r requirements-postgres.txt
```

Apply migrations:

```bash
.venv-pg/bin/python apply_postgres_migrations.py --env-file /mnt/storage/aic/.env
```

Sync local SQLite staging data into Postgres:

```bash
.venv-pg/bin/python sync_sqlite_to_postgres.py --env-file /mnt/storage/aic/.env --sqlite-db rag_test.sqlite3
```

Sync Podtrac statistics into Postgres:

```bash
.venv-pg/bin/python sync_podtrac_to_postgres.py --env-file /mnt/storage/aic/.env --podtrac-db podtrac_stats.sqlite3
```

## Environment

Server scripts read these values authoritatively from `/mnt/storage/aic/.env`:

```text
DB_HOST=192.168.1.106
DB_PORT=5432
DB_NAME=aic
DB_USER=
DB_PASSWORD=
```

Do not commit `.env`.

The file values replace inherited `DB_*`, `DATABASE_URL`, and libpq routing
variables. Commands fail closed if the endpoint is not exactly
`192.168.1.106:5432`. Never create, copy, clone, restore, or select another
PostgreSQL database for migration or validation.

## Tables

- `episodes`
- `transcript_chunks`
- `episode_intelligence`
- `episode_intelligence_items`
- `episode_intelligence_vectors`
- `podtrac_import_runs`
- `podtrac_import_metadata`
- `podtrac_episodes`
- `podtrac_countries`
- `podtrac_clients`
- `podtrac_daily_activity`
- `podtrac_activity_by_country`
- `podtrac_activity_by_client`
- `sync_runs`
- `podtrac_sync_runs`

`transcript_chunks.embedding` and `episode_intelligence_vectors.embedding` use `vector(1536)` for `text-embedding-3-small`.

`podtrac_episodes.track_id` links Podtrac's opaque episode id to the canonical `episodes.track_id`.
The sync script first uses normalized title matching, then resolves repeated titles by choosing the nearest
publish date. This keeps the original Podtrac id intact while making stats joinable to RAG episode metadata.
