#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run the restore drill as root." >&2
  exit 1
fi

env_file="${STRAPI_BACKUP_ENV_FILE:-/etc/aic/strapi.env}"
backup_root="${STRAPI_BACKUP_ROOT:-/mnt/storage/backups/aic-strapi}"
postgres_container="${STRAPI_POSTGRES_CONTAINER:-farm-postgres}"
docker_bin="${STRAPI_BACKUP_DOCKER_BIN:-/usr/bin/docker}"
postgres_image="${STRAPI_BACKUP_POSTGRES_IMAGE:-postgres:16}"

if [[ "${env_file}" != "/etc/aic/strapi.env" || "${backup_root}" != "/mnt/storage/backups/aic-strapi" ]]; then
  echo "Refusing unexpected restore-drill paths." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${env_file}"
: "${DATABASE_HOST:?DATABASE_HOST is required}"
: "${DATABASE_PORT:?DATABASE_PORT is required}"
: "${DATABASE_USERNAME:?DATABASE_USERNAME is required}"
: "${DATABASE_PASSWORD:?DATABASE_PASSWORD is required}"

latest_backup="$(find "${backup_root}" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??T??????Z' -print | sort | tail -n 1)"
if [[ -z "${latest_backup}" || ! -f "${latest_backup}/database.dump" || ! -f "${latest_backup}/SHA256SUMS" ]]; then
  echo "No complete Strapi backup is available for a restore drill." >&2
  exit 1
fi
case "${latest_backup}" in
  /mnt/storage/backups/aic-strapi/20??-??-??T??????Z) ;;
  *) echo "Refusing unexpected backup directory: ${latest_backup}" >&2; exit 1 ;;
esac

(
  cd "${latest_backup}"
  sha256sum --check SHA256SUMS
)

drill_database="aic_strapi_restore_$(date -u +%Y%m%d%H%M%S)_$$"
if [[ ! "${drill_database}" =~ ^aic_strapi_restore_[0-9]{14}_[0-9]+$ ]]; then
  echo "Unsafe restore database name." >&2
  exit 1
fi

drill_media="$(mktemp -d /mnt/storage/backups/aic-strapi-restore-drill.XXXXXX)"
cleanup() {
  if [[ -n "${drill_database:-}" && "${drill_database}" =~ ^aic_strapi_restore_[0-9]{14}_[0-9]+$ ]]; then
    printf 'DROP DATABASE IF EXISTS %s WITH (FORCE);\n' "${drill_database}" |
      "${docker_bin}" exec -i "${postgres_container}" sh -lc \
        'psql -X --set ON_ERROR_STOP=1 --quiet -U "$POSTGRES_USER" -d postgres' >/dev/null 2>&1 || true
  fi
  if [[ -n "${drill_media:-}" && "${drill_media}" == /mnt/storage/backups/aic-strapi-restore-drill.* && -d "${drill_media}" ]]; then
    rm -rf -- "${drill_media}"
  fi
}
trap cleanup EXIT

printf 'CREATE DATABASE %s OWNER %s;\n' "${drill_database}" "${DATABASE_USERNAME}" |
  "${docker_bin}" exec -i "${postgres_container}" sh -lc \
    'psql -X --set ON_ERROR_STOP=1 --quiet -U "$POSTGRES_USER" -d postgres'

container_safety=(
  --rm
  --pull=never
  --read-only
  --cap-drop ALL
  --security-opt no-new-privileges
  --user "$(id -u ammonsfarm):$(id -g ammonsfarm)"
)

PGPASSWORD="${DATABASE_PASSWORD}" "${docker_bin}" run \
  "${container_safety[@]}" \
  --network host \
  --env PGPASSWORD \
  --mount "type=bind,src=${latest_backup},dst=/backup,readonly" \
  "${postgres_image}" \
  pg_restore \
  --host "${DATABASE_HOST}" \
  --port "${DATABASE_PORT}" \
  --username "${DATABASE_USERNAME}" \
  --dbname "${drill_database}" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  /backup/database.dump

table_count="$(PGPASSWORD="${DATABASE_PASSWORD}" "${docker_bin}" run \
  "${container_safety[@]}" \
  --network host \
  --env PGPASSWORD \
  "${postgres_image}" \
  psql \
  --host "${DATABASE_HOST}" \
  --port "${DATABASE_PORT}" \
  --username "${DATABASE_USERNAME}" \
  --dbname "${drill_database}" \
  --tuples-only --no-align \
  --command "select count(*) from pg_tables where schemaname = 'public'" | tr -d '[:space:]')"

if [[ ! "${table_count}" =~ ^[0-9]+$ || "${table_count}" -lt 1 ]]; then
  echo "Restored database contains no public tables." >&2
  exit 1
fi

media_count=0
if [[ -f "${latest_backup}/media.tar.gz" ]]; then
  tar --extract --gzip --file "${latest_backup}/media.tar.gz" --directory "${drill_media}" \
    --no-same-owner --no-same-permissions
  media_count="$(find "${drill_media}" -type f -print | wc -l | tr -d '[:space:]')"
fi

echo "Restore drill passed for $(basename "${latest_backup}"): ${table_count} database tables, ${media_count} media files."
