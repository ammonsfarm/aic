# Podtrac Daily Ingest

This directory tracks the current Mac-side Podtrac ingest automation for AIC.
The live runtime is installed from `/Users/van/firebase/aic_podcast`, but the
source is kept here so the automation is versioned with `ammonsfarm/aic`.

## Current Path

- Fetches Podtrac episode, country, and client daily reports.
- Uses the signed-in Chrome session by default.
- Writes directly to PostgreSQL.
- Reads the declared Mac workspace `.env` authoritatively and requires the
  existing AIC endpoint at `192.168.1.106:5432`; inherited database variables
  cannot repoint it.
- Does not use SQLite for current ingest, fixes, staging, or sync.
- Catches up automatically from the latest Podtrac activity date in Postgres,
  with a seven-day lookback and a forty-five-day maximum window.

## Files

- `run_daily_podtrac_ingest.py`: direct Podtrac API fetcher and Postgres upsert.
- `install_podtrac_launchagent.sh`: installs the daily macOS LaunchAgent.
- `run_podtrac_ingest_terminal.applescript`: Terminal wrapper used by launchd
  so Chrome auth and LAN database routing behave like an interactive session.

## Install

The default live workspace is `/Users/van/firebase/aic_podcast`.

```bash
cd /Users/van/firebase/aic_podcast
scripts/install_podtrac_launchagent.sh
```

If the live workspace moves, set `AIC_PODCAST_ROOT` before installing and update
the AppleScript `rootPath` to the same location.

```bash
AIC_PODCAST_ROOT=/path/to/aic_podcast scripts/install_podtrac_launchagent.sh
```

The LaunchAgent runs daily at seven thirty local time:

```bash
launchctl print "gui/$(id -u)/com.ammonsfarm.aic-podtrac-ingest"
```

## Manual Run

Chrome must already be signed in to `https://publisher.podtrac.com/`.

```bash
cd /Users/van/firebase/aic_podcast
.venv-pg/bin/python run_daily_podtrac_ingest.py \
  --env-file .env \
  --auth-mode chrome
```

Use `--dry-run` to fetch and report counts without writing to Postgres.

The Mac runtime does not depend on `/mnt/storage/aic/.env`, which is a farm-host
path. Its explicitly supplied local `.env` must contain credentials for the same
existing AIC database. Never create, copy, clone, or restore another database for
Podtrac ingestion.

## Farm admin and scheduled path

The protected AIC admin action and the farm schedule do not invoke the legacy
`/mnt/storage/aic_podcast/scripts/run_podtrac_daily_server.sh` wrapper. They run
this versioned AIC runner directly with `--server-admin-mode`, the AIC web
Python environment, exact `/mnt/storage/aic/.env`, curl authentication from
`/mnt/storage/aic_podcast/podtrac-auth.curl`, and logs under the podcast
workspace. Server mode rejects any other runner, interpreter, env, auth, log,
or authentication-mode path.

Deployment installs `aic-podtrac-daily-ingest.timer` and
`aic-podcast-daily-ingest.timer` at the existing 04:15 schedule. Only after
both replacement timers are active does the deployment remove the two exact
legacy cron commands; unrelated and commented cron entries are preserved.
The deploy process holds the podcast runner's
`/mnt/storage/aic_podcast/daily_ingest.lock` and Podtrac's
`/tmp/aic_podtrac_ingest.lock` from before checkout mutation through verified
timer startup, so a scheduled job cannot overlap migrations or service
cutover.

## Validation

Check recent activity dates after a run:

```sql
select count(*), max(activity_date) from podtrac_daily_activity;
select count(*), max(activity_date) from podtrac_activity_by_country;
select count(*), max(activity_date) from podtrac_activity_by_client;
```

Check the launchd wrapper logs:

```bash
tail -n 80 /Users/van/firebase/aic_podcast/run_logs/terminal_podtrac_ingest.log
tail -n 80 /Users/van/firebase/aic_podcast/run_logs/launchd_podtrac_ingest.err.log
```

Never commit `.env`, `podtrac-auth.curl`, run logs, cookies, HAR files, or
other session material.
