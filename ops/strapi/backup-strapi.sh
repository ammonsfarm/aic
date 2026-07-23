#!/usr/bin/env bash
set -euo pipefail
umask 077

backup_root="${STRAPI_BACKUP_ROOT:-/mnt/storage/backups/aic-strapi}"
media_root="${STRAPI_MEDIA_ROOT:-/mnt/storage/pastorwood-media/strapi/uploads}"
retention_days="${STRAPI_BACKUP_RETENTION_DAYS:-30}"
docker_bin="${STRAPI_BACKUP_DOCKER_BIN:-/usr/bin/docker}"
postgres_client_image="${STRAPI_BACKUP_POSTGRES_IMAGE:-postgres:16}"
dry_run="${STRAPI_BACKUP_DRY_RUN:-0}"

case "${backup_root}" in
  /mnt/storage/backups/*) ;;
  *)
    echo "Refusing unexpected backup root: ${backup_root}" >&2
    exit 1
    ;;
esac

: "${DATABASE_HOST:?DATABASE_HOST is required}"
: "${DATABASE_PORT:?DATABASE_PORT is required}"
: "${DATABASE_NAME:?DATABASE_NAME is required}"
: "${DATABASE_USERNAME:?DATABASE_USERNAME is required}"
: "${DATABASE_PASSWORD:?DATABASE_PASSWORD is required}"
: "${DATABASE_SCHEMA:?DATABASE_SCHEMA is required}"

if [[ "${DATABASE_SCHEMA}" != "aic_strapi" ]]; then
  echo "Refusing unexpected Strapi backup schema: ${DATABASE_SCHEMA}" >&2
  exit 1
fi
if [[ "${DATABASE_HOST}" != "192.168.1.106" || "${DATABASE_PORT}" != "5432" ]]; then
  echo "Refusing any PostgreSQL backup target other than 192.168.1.106:5432." >&2
  exit 1
fi

case "${dry_run}" in
  0|1) ;;
  *)
    echo "STRAPI_BACKUP_DRY_RUN must be 0 or 1" >&2
    exit 1
    ;;
esac

if [[ ! -x "${docker_bin}" ]]; then
  echo "Docker is required at ${docker_bin}" >&2
  exit 1
fi

if ! "${docker_bin}" image inspect "${postgres_client_image}" >/dev/null 2>&1; then
  echo "Required local PostgreSQL client image is missing: ${postgres_client_image}" >&2
  echo "Install it explicitly before enabling backups; the backup job never pulls images." >&2
  exit 1
fi

docker_safety=(
  --rm
  --pull=never
  --read-only
  --cap-drop ALL
  --security-opt no-new-privileges
  --user "$(id -u):$(id -g)"
)

if [[ "${dry_run}" == "1" ]]; then
  "${docker_bin}" run "${docker_safety[@]}" --network none \
    "${postgres_client_image}" pg_dump --version
  "${docker_bin}" run "${docker_safety[@]}" --network none \
    "${postgres_client_image}" pg_restore --version
  echo "Strapi backup dry run passed with ${postgres_client_image}; no backup files were created."
  exit 0
fi

install -d -m 0700 "${backup_root}"
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
final_dir="${backup_root}/${stamp}"
partial_dir="$(mktemp -d "${backup_root}/.partial-${stamp}.XXXXXX")"

cleanup() {
  if [[ -n "${partial_dir:-}" && -d "${partial_dir}" ]]; then
    rm -rf -- "${partial_dir}"
  fi
}
trap cleanup EXIT

PGPASSWORD="${DATABASE_PASSWORD}" "${docker_bin}" run \
  "${docker_safety[@]}" \
  --network host \
  --env PGPASSWORD \
  --mount "type=bind,src=${partial_dir},dst=/backup" \
  "${postgres_client_image}" \
  pg_dump \
  --host "${DATABASE_HOST}" \
  --port "${DATABASE_PORT}" \
  --username "${DATABASE_USERNAME}" \
  --dbname "${DATABASE_NAME}" \
  --schema "${DATABASE_SCHEMA}" \
  --format custom \
  --no-owner \
  --no-privileges \
  --file /backup/database.dump

"${docker_bin}" run \
  "${docker_safety[@]}" \
  --network none \
  --mount "type=bind,src=${partial_dir},dst=/backup,readonly" \
  "${postgres_client_image}" \
  pg_restore --list /backup/database.dump > "${partial_dir}/database.contents"

if [[ ! -s "${partial_dir}/database.contents" ]] ||
   ! grep -Fq "SCHEMA - ${DATABASE_SCHEMA}" "${partial_dir}/database.contents"; then
  echo "Strapi database archive does not contain the expected ${DATABASE_SCHEMA} schema." >&2
  exit 1
fi

# Replaying the archive to /dev/null decompresses every archived object and data
# block without connecting to or restoring any database.
"${docker_bin}" run \
  "${docker_safety[@]}" \
  --network none \
  --mount "type=bind,src=${partial_dir},dst=/backup,readonly" \
  "${postgres_client_image}" \
  pg_restore --exit-on-error --file=/dev/null /backup/database.dump

if [[ ! -d "${media_root}" ]]; then
  echo "Required Strapi media root is missing: ${media_root}" >&2
  exit 1
fi
tar --create --gzip --file "${partial_dir}/media.tar.gz" --directory "${media_root}" .
tar --list --gzip --file "${partial_dir}/media.tar.gz" > "${partial_dir}/media.contents"

{
  printf 'created_at=%s\n' "${stamp}"
  printf 'database=%s\n' "${DATABASE_NAME}"
  printf 'database_host=%s\n' "${DATABASE_HOST}"
  printf 'database_port=%s\n' "${DATABASE_PORT}"
  printf 'database_schema=%s\n' "${DATABASE_SCHEMA}"
  printf 'media_root=%s\n' "${media_root}"
} > "${partial_dir}/manifest.env"

(
  cd "${partial_dir}"
  sha256sum database.dump database.contents media.contents manifest.env > SHA256SUMS
  sha256sum media.tar.gz >> SHA256SUMS
  sha256sum --check SHA256SUMS
)

mv -- "${partial_dir}" "${final_dir}"
partial_dir=""

find "${backup_root}"   -mindepth 1   -maxdepth 1   -type d   -name '20??-??-??T??????Z'   -mtime "+${retention_days}"   -exec rm -rf -- {} +

echo "Verified Strapi backup created: ${final_dir}"
