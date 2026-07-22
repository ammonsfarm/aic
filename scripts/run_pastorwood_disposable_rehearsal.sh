#!/usr/bin/env bash
set -euo pipefail

worktree=/mnt/storage/aic-worktrees/pastorwood-public-cutover-20260722
dump=/mnt/storage/backups/aic-pastorwood/aic-preintegration-20260722.dump
snapshot=${1:?usage: run_pastorwood_disposable_rehearsal.sh SNAPSHOT [REST_MEDIA_BACKUP_MANIFEST] [EXTERNAL_IMAGE_BACKUP_MANIFEST] [plan|analysis]}
backup_manifest=${2:-}
external_image_manifest=${3:-}
mode=${4:-plan}
suffix="$(date -u +%Y%m%d%H%M%S)_$RANDOM"
database="pwcutover_${suffix}"
role="pwcutover_role_${suffix}"
password="$(openssl rand -hex 32)"

cleanup() {
  docker exec farm-postgres psql --no-psqlrc -v ON_ERROR_STOP=1 -Atq -U farmfam -d postgres \
    -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '${database}' and pid <> pg_backend_pid();" >/dev/null 2>&1 || true
  docker exec farm-postgres psql --no-psqlrc -v ON_ERROR_STOP=1 -Atq -U farmfam -d postgres \
    -c "drop database if exists \"${database}\";" >/dev/null 2>&1 || true
  docker exec farm-postgres psql --no-psqlrc -v ON_ERROR_STOP=1 -Atq -U farmfam -d postgres \
    -c "drop role if exists \"${role}\";" >/dev/null 2>&1 || true
  remaining_db="$(docker exec farm-postgres psql --no-psqlrc -Atq -U farmfam -d postgres -c "select count(*) from pg_database where datname='${database}';" 2>/dev/null || printf 'unknown')"
  remaining_role="$(docker exec farm-postgres psql --no-psqlrc -Atq -U farmfam -d postgres -c "select count(*) from pg_roles where rolname='${role}';" 2>/dev/null || printf 'unknown')"
  printf 'disposable_cleanup db_remaining=%s role_remaining=%s\n' "$remaining_db" "$remaining_role"
}
trap cleanup EXIT

printf "create role \"%s\" login password '%s'; create database \"%s\" owner \"%s\";" "$role" "$password" "$database" "$role" \
  | docker exec -i farm-postgres psql --no-psqlrc -v ON_ERROR_STOP=1 -Atq -U farmfam -d postgres >/dev/null

export PGPASSWORD="$password"
docker run --rm --pull=never --network host --read-only --cap-drop ALL --security-opt no-new-privileges \
  -e PGPASSWORD \
  -v "$dump:/dump/aic.dump:ro" \
  postgres:16 pg_restore --exit-on-error --no-owner --no-privileges \
  --host 127.0.0.1 --port 5433 --username "$role" --dbname "$database" \
  --table episodes --table pastorwood_posts /dump/aic.dump >/dev/null

args=(
  --env-file /dev/null
  --wordpress-rest-snapshot "$snapshot"
  --verify-media
  --verify-episode-audio
  --plan-output docs/pastorwood-cutover-dry-run.json
  --redirect-output data/legacy-redirects.json
  --media-output data/public-media-manifest.json
)
if [[ -n "$backup_manifest" ]]; then
  args+=(--rest-media-backup-manifest "$backup_manifest")
fi
if [[ -n "$external_image_manifest" ]]; then
  args+=(--external-image-backup-manifest "$external_image_manifest")
fi

cd "$worktree"
if [[ "$mode" == "analysis" ]]; then
  DB_HOST=127.0.0.1 DB_PORT=5433 DB_NAME="$database" DB_USER="$role" DB_PASSWORD="$password" \
    python3 scripts/analyze_pastorwood_episode_reconciliation.py \
      --snapshot "$snapshot" --output /tmp/pastorwood-episode-match-analysis.json
  exit 0
fi
DB_HOST=127.0.0.1 DB_PORT=5433 DB_NAME="$database" DB_USER="$role" DB_PASSWORD="$password" \
  python3 scripts/pastorwood_cutover_import.py "${args[@]}" >/dev/null

printf 'disposable_rehearsal plan=%s\n' "$worktree/docs/pastorwood-cutover-dry-run.json"
