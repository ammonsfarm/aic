#!/usr/bin/env bash
set -euo pipefail
umask 077

backup_root="${STRAPI_BACKUP_ROOT:-/mnt/storage/backups/aic-strapi}"
media_root="${STRAPI_MEDIA_ROOT:-/mnt/storage/pastorwood-media/strapi/uploads}"
retention_days="${STRAPI_BACKUP_RETENTION_DAYS:-30}"
dry_run="${STRAPI_BACKUP_DRY_RUN:-0}"
canonical_client_root="/usr/lib/postgresql/16/bin"
client_root="${STRAPI_POSTGRES_CLIENT_ROOT:-${canonical_client_root}}"
client_test_mode="${STRAPI_NATIVE_CLIENT_TEST_MODE:-0}"

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

script_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck disable=SC1091
source "${script_root}/require-canonical-db-context.sh"

case "${dry_run}" in
  0|1) ;;
  *)
    echo "STRAPI_BACKUP_DRY_RUN must be 0 or 1" >&2
    exit 1
    ;;
esac
if [[ "${client_test_mode}" != "0" && "${client_test_mode}" != "1" ]]; then
  echo "STRAPI_NATIVE_CLIENT_TEST_MODE must be 0 or 1." >&2
  exit 1
fi
if [[ "${client_test_mode}" == "1" && "${NODE_ENV:-}" == "production" ]]; then
  echo "Native client test overrides are forbidden in production." >&2
  exit 1
fi
if [[ "${client_test_mode}" == "0" && "${client_root}" != "${canonical_client_root}" ]]; then
  echo "Production backups require PostgreSQL 16 clients at ${canonical_client_root}." >&2
  exit 1
fi
if [[ ! "${retention_days}" =~ ^[0-9]+$ ]] || (( retention_days < 1 || retention_days > 3650 )); then
  echo "STRAPI_BACKUP_RETENTION_DAYS must be between 1 and 3650." >&2
  exit 1
fi
pg_dump_bin="${client_root}/pg_dump"
pg_restore_bin="${client_root}/pg_restore"
if [[ ! -x "${pg_dump_bin}" ]] || ! "${pg_dump_bin}" --version | grep -Eq '^pg_dump \(PostgreSQL\) 16\.'; then
  echo "Native PostgreSQL 16 pg_dump is required at ${pg_dump_bin}." >&2
  exit 1
fi
if [[ ! -x "${pg_restore_bin}" ]] || ! "${pg_restore_bin}" --version | grep -Eq '^pg_restore \(PostgreSQL\) 16\.'; then
  echo "Native PostgreSQL 16 pg_restore is required at ${pg_restore_bin}." >&2
  exit 1
fi

if [[ "${dry_run}" == "1" ]]; then
  "${pg_dump_bin}" --version
  "${pg_restore_bin}" --version
  echo "Strapi backup dry run passed with native PostgreSQL 16 clients; no backup files were created."
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

PGCONNECT_TIMEOUT=5 PGPASSWORD="${DATABASE_PASSWORD}" "${pg_dump_bin}" \
  --host "${DATABASE_HOST}" \
  --port "${DATABASE_PORT}" \
  --username "${DATABASE_USERNAME}" \
  --dbname "${DATABASE_NAME}" \
  --schema "${DATABASE_SCHEMA}" \
  --format custom \
  --no-owner \
  --no-privileges \
  --lock-wait-timeout=30s \
  --file "${partial_dir}/database.dump"

"${pg_restore_bin}" --list "${partial_dir}/database.dump" > "${partial_dir}/database.contents"

if [[ ! -s "${partial_dir}/database.contents" ]] ||
   ! grep -Fq "SCHEMA - ${DATABASE_SCHEMA}" "${partial_dir}/database.contents"; then
  echo "Strapi database archive does not contain the expected ${DATABASE_SCHEMA} schema." >&2
  exit 1
fi

# Replaying the archive to /dev/null decompresses every archived object and data
# block without connecting to or restoring any database.
"${pg_restore_bin}" --exit-on-error --file=/dev/null "${partial_dir}/database.dump"

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
  printf 'postgres_client_major=16\n'
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
