# Worker database authority

The existing PostgreSQL database at `192.168.1.106:5432` is the only database
used by AIC web, admin, episode-publication, podcast-ingest, and Podtrac paths.
Production values for `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and
`DB_PASSWORD` come only from `/mnt/storage/aic/.env`.

The admin-operation and episode-publication workers enforce this at both
boundaries:

- their own psycopg connection loads the canonical AIC file and rejects a
  different path, host, port, duplicate DB key, `DATABASE_URL`, or `PG*` key;
- every child command explicitly supplies `--env-file /mnt/storage/aic/.env`;
- every child environment replaces inherited `DB_*` values and removes all
  inherited `DATABASE_URL` and `PG*` values;
- production worker, interpreter, AIC root, podcast root, and runner paths are
  fixed and checked before work starts.

`/mnt/storage/aic_podcast/.env` remains a supplemental provider source during
the podcast-workspace transition. Its one legacy copy of each `DB_*` value is
accepted only when it exactly matches the canonical file and is never passed
through as database authority. Only the explicitly allowlisted provider keys
needed by the pipeline are exported. Duplicate or unexpected sensitive keys,
process-control values such as `PATH`, `PYTHONPATH`, or `LD_PRELOAD`, Strapi
settings, `DATABASE_URL`, and every `PG*` key are rejected.

The server Podtrac action executes the versioned
`/mnt/storage/aic/ops/podtrac/run_daily_podtrac_ingest.py` directly. The
external podcast workspace supplies only its curl authentication capture and
log directory; its wrapper and database loader are not used.
