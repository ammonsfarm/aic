#!/usr/bin/env bash
set -euo pipefail
umask 077

backup_root="${STRAPI_BACKUP_ROOT:-/mnt/storage/backups/aic-strapi}"
canonical_client_root="/usr/lib/postgresql/16/bin"
client_root="${STRAPI_POSTGRES_CLIENT_ROOT:-${canonical_client_root}}"
client_test_mode="${STRAPI_NATIVE_CLIENT_TEST_MODE:-0}"

backup_test_root="${STRAPI_BACKUP_TEST_ROOT:-}"
if [[ "${client_test_mode}" != "0" && "${client_test_mode}" != "1" ]]; then
  echo "STRAPI_NATIVE_CLIENT_TEST_MODE must be 0 or 1." >&2
  exit 1
fi
if [[ "${client_test_mode}" == "0" ]]; then
  if [[ -n "${backup_test_root}" || "${backup_root}" != "/mnt/storage/backups/aic-strapi" ]]; then
    echo "Production verification requires the exact AIC backup root." >&2
    exit 1
  fi
elif [[ -n "${backup_test_root}" ]]; then
  if [[ "${client_test_mode}" != "1" || "${NODE_ENV:-}" != "test" ||
        ! -d "${backup_test_root}" || -L "${backup_test_root}" ]]; then
    echo "Backup verification test paths require isolated native-client test mode." >&2
    exit 1
  fi
  backup_test_root="$(readlink -m -- "${backup_test_root}")"
  if [[ "${backup_test_root}" != /tmp/aic-strapi-backup-test-* ||
        "$(readlink -m -- "${backup_root}")" != "${backup_test_root}"/* ]]; then
    echo "Backup verification test paths must stay inside the dedicated test root." >&2
    exit 1
  fi
else
  echo "Backup verification tests require STRAPI_BACKUP_TEST_ROOT." >&2
  exit 1
fi

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
if [[ -L "${backup_dir}" || ! -d "${backup_dir}" ]]; then
  echo "Refusing a missing or symlinked Strapi backup directory." >&2
  exit 1
fi

required_payloads=(
  aic-strapi-schema.dump
  aic-strapi-schema.contents
  public-operational.dump
  public-operational.contents
  media.tar.gz
  media.contents
  manifest.env
)
for required in "${required_payloads[@]}" SHA256SUMS; do
  if [[ -L "${backup_dir}/${required}" || ! -f "${backup_dir}/${required}" ]]; then
    echo "Incomplete Strapi backup: missing ${required}." >&2
    exit 1
  fi
done
mapfile -t dump_files < <(find "${backup_dir}" -maxdepth 1 -type f -name '*.dump' -printf '%f\n' | sort)
if [[ "${#dump_files[@]}" -ne 2 ||
      "${dump_files[0]:-}" != "aic-strapi-schema.dump" ||
      "${dump_files[1]:-}" != "public-operational.dump" ]]; then
  echo "Backup must contain exactly the two approved PostgreSQL archives." >&2
  exit 1
fi

inventory_file="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/backup-object-inventory.txt"
toc_validator="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/validate-backup-toc.py"
if [[ ! -f "${inventory_file}" || ! -x "${toc_validator}" ]]; then
  echo "Installed backup object inventory and TOC validator are required." >&2
  exit 1
fi
public_tables=()
public_sequences=()
while read -r object_kind object_name unexpected; do
  if [[ -z "${object_kind}" || "${object_kind}" == \#* ]]; then
    continue
  fi
  if [[ -n "${unexpected:-}" || ! "${object_name:-}" =~ ^public\.[a-z][a-z0-9_]{0,62}$ ]]; then
    echo "Backup object inventory is invalid." >&2
    exit 1
  fi
  case "${object_kind}" in
    table) public_tables+=("${object_name}") ;;
    sequence) public_sequences+=("${object_name}") ;;
    *)
      echo "Backup object inventory is invalid." >&2
      exit 1
      ;;
  esac
done < "${inventory_file}"
if [[ "${#public_tables[@]}" -ne 11 || "${#public_sequences[@]}" -ne 6 ]]; then
  echo "Backup object inventory must contain exactly 11 tables and 6 sequences." >&2
  exit 1
fi
public_tables_csv="$(IFS=,; printf '%s' "${public_tables[*]}")"
public_sequences_csv="$(IFS=,; printf '%s' "${public_sequences[*]}")"

manifest="${backup_dir}/manifest.env"
require_manifest_line() {
  expected="$1"
  if [[ "$(grep -Fxc "${expected}" "${manifest}" || true)" != "1" ]]; then
    echo "Backup manifest is missing or duplicates required evidence." >&2
    exit 1
  fi
}
require_manifest_line 'format_version=2'
require_manifest_line "created_at=$(basename -- "${backup_dir}")"
require_manifest_line 'database_host=192.168.1.106'
require_manifest_line 'database_port=5432'
require_manifest_line 'database_schema=aic_strapi'
require_manifest_line 'snapshot_isolation=repeatable-read'
require_manifest_line 'snapshot_read_only=true'
require_manifest_line 'schema_archive=aic-strapi-schema.dump'
require_manifest_line 'public_archive=public-operational.dump'
require_manifest_line "public_tables=${public_tables_csv}"
require_manifest_line "public_sequences=${public_sequences_csv}"
require_manifest_line 'postgres_client_major=16'
if [[ "${client_test_mode}" == "0" ]]; then
  require_manifest_line 'media_root=/mnt/storage/pastorwood-media/strapi/uploads'
fi
if [[ "$(grep -Ec '^database_name=.+$' "${manifest}" || true)" != "1" ||
      "$(grep -Ec '^snapshot_id=[0-9A-Fa-f-]{1,128}$' "${manifest}" || true)" != "1" ||
      "$(grep -Ec '^media_root=/.+$' "${manifest}" || true)" != "1" ]]; then
  echo "Backup manifest source or snapshot evidence is invalid." >&2
  exit 1
fi

if [[ "$(wc -l < "${backup_dir}/SHA256SUMS")" -ne "${#required_payloads[@]}" ]]; then
  echo "Backup checksum inventory has an unexpected number of entries." >&2
  exit 1
fi
for payload in "${required_payloads[@]}"; do
  if [[ "$(grep -Ec "^[0-9a-f]{64}  ${payload//./\\.}$" "${backup_dir}/SHA256SUMS" || true)" != "1" ]]; then
    echo "Backup checksum inventory is incomplete or duplicated." >&2
    exit 1
  fi
done

(
  cd "${backup_dir}"
  sha256sum --check SHA256SUMS
)

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

"${pg_restore_bin}" --list "${backup_dir}/aic-strapi-schema.dump" > "${temporary_dir}/aic-strapi-schema.contents"
"${pg_restore_bin}" --list "${backup_dir}/public-operational.dump" > "${temporary_dir}/public-operational.contents"
cmp --silent "${backup_dir}/aic-strapi-schema.contents" "${temporary_dir}/aic-strapi-schema.contents"
cmp --silent "${backup_dir}/public-operational.contents" "${temporary_dir}/public-operational.contents"
"/usr/bin/python3" "${toc_validator}" schema "${temporary_dir}/aic-strapi-schema.contents"
"/usr/bin/python3" "${toc_validator}" public "${temporary_dir}/public-operational.contents"

"${pg_restore_bin}" --exit-on-error --file=/dev/null "${backup_dir}/aic-strapi-schema.dump"
"${pg_restore_bin}" --exit-on-error --file=/dev/null "${backup_dir}/public-operational.dump"

tar --list --gzip --file "${backup_dir}/media.tar.gz" > "${temporary_dir}/media.contents"
cmp --silent "${backup_dir}/media.contents" "${temporary_dir}/media.contents"

echo "Verified both PostgreSQL archives, exact TOC inventories, media, and checksums offline without restoring a database: ${backup_dir}"
