#!/usr/bin/env bash
set -euo pipefail
umask 077

backup_root="${STRAPI_BACKUP_ROOT:-/mnt/storage/backups/aic-strapi}"
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

if [[ "$#" -gt 1 ]]; then
  echo "Usage: $0 [backup-directory]" >&2
  exit 1
fi

backup_dir="${1:-}"
if [[ -z "${backup_dir}" ]]; then
  backup_dir="$(find "${backup_root}" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??T??????Z' -print | sort | tail -n 1)"
fi
case "${backup_dir}" in
  "${backup_root}"/20??-??-??T??????Z) ;;
  *)
    echo "Refusing unexpected or missing Strapi backup directory: ${backup_dir:-none}" >&2
    exit 1
    ;;
esac

for required in database.dump database.contents media.tar.gz media.contents manifest.env SHA256SUMS; do
  if [[ ! -f "${backup_dir}/${required}" ]]; then
    echo "Incomplete Strapi backup: missing ${required}." >&2
    exit 1
  fi
done
if ! grep -Fxq 'database_schema=aic_strapi' "${backup_dir}/manifest.env"; then
  echo "Backup manifest is not scoped to the aic_strapi schema." >&2
  exit 1
fi
if ! grep -Fxq 'database_host=192.168.1.106' "${backup_dir}/manifest.env" ||
   ! grep -Fxq 'database_port=5432' "${backup_dir}/manifest.env"; then
  echo "Backup manifest does not identify the existing AIC PostgreSQL target." >&2
  exit 1
fi

(
  cd "${backup_dir}"
  sha256sum --check SHA256SUMS
)

if [[ "${client_test_mode}" != "0" && "${client_test_mode}" != "1" ]]; then
  echo "STRAPI_NATIVE_CLIENT_TEST_MODE must be 0 or 1." >&2
  exit 1
fi
if [[ "${client_test_mode}" == "1" && "${NODE_ENV:-}" == "production" ]]; then
  echo "Native client test overrides are forbidden in production." >&2
  exit 1
fi
if [[ "${client_test_mode}" == "0" && "${client_root}" != "${canonical_client_root}" ]]; then
  echo "Production verification requires PostgreSQL 16 clients at ${canonical_client_root}." >&2
  exit 1
fi
pg_restore_bin="${client_root}/pg_restore"
if [[ ! -x "${pg_restore_bin}" ]] || ! "${pg_restore_bin}" --version | grep -Eq '^pg_restore \(PostgreSQL\) 16\.'; then
  echo "Native PostgreSQL 16 pg_restore is required at ${pg_restore_bin}." >&2
  exit 1
fi

temporary_dir="$(mktemp -d /tmp/aic-strapi-backup-verify.XXXXXX)"
cleanup() {
  rm -rf -- "${temporary_dir}"
}
trap cleanup EXIT

"${pg_restore_bin}" --list "${backup_dir}/database.dump" > "${temporary_dir}/database.contents"

"${pg_restore_bin}" --exit-on-error --file=/dev/null "${backup_dir}/database.dump"

cmp --silent "${backup_dir}/database.contents" "${temporary_dir}/database.contents"
grep -Fq 'SCHEMA - aic_strapi' "${temporary_dir}/database.contents"

tar --list --gzip --file "${backup_dir}/media.tar.gz" > "${temporary_dir}/media.contents"
cmp --silent "${backup_dir}/media.contents" "${temporary_dir}/media.contents"

echo "Verified Strapi backup archives, listings, and checksums without restoring a database: ${backup_dir}"
