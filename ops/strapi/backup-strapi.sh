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
python_bin="/usr/bin/python3"

backup_test_root="${STRAPI_BACKUP_TEST_ROOT:-}"
if [[ "${client_test_mode}" != "0" && "${client_test_mode}" != "1" ]]; then
  echo "STRAPI_NATIVE_CLIENT_TEST_MODE must be 0 or 1." >&2
  exit 1
fi
if [[ "${client_test_mode}" == "0" ]]; then
  if [[ -n "${backup_test_root}" ||
        "${backup_root}" != "/mnt/storage/backups/aic-strapi" ||
        "${media_root}" != "/mnt/storage/pastorwood-media/strapi/uploads" ]]; then
    echo "Production backups require the exact AIC backup and Strapi media roots." >&2
    exit 1
  fi
elif [[ -n "${backup_test_root}" ]]; then
  if [[ "${client_test_mode}" != "1" || "${NODE_ENV:-}" != "test" ||
        ! -d "${backup_test_root}" || -L "${backup_test_root}" ]]; then
    echo "Backup test paths require isolated native-client test mode." >&2
    exit 1
  fi
  backup_test_root="$(readlink -m -- "${backup_test_root}")"
  if [[ "${backup_test_root}" != /tmp/aic-strapi-backup-test-* ||
        "$(readlink -m -- "${backup_root}")" != "${backup_test_root}"/* ||
        "$(readlink -m -- "${media_root}")" != "${backup_test_root}"/* ]]; then
    echo "Backup test paths must stay inside the dedicated test root." >&2
    exit 1
  fi
fi

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
if [[ "${client_test_mode}" == "1" && "${NODE_ENV:-}" == "production" ]]; then
  echo "Native client test overrides are forbidden in production." >&2
  exit 1
fi
if [[ "${client_test_mode}" == "1" && "${dry_run}" != "1" && -z "${backup_test_root}" ]]; then
  echo "Non-dry-run backup tests require STRAPI_BACKUP_TEST_ROOT." >&2
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
psql_bin="${client_root}/psql"
if [[ ! -x "${psql_bin}" ]] || ! "${psql_bin}" --version | grep -Eq '^psql \(PostgreSQL\) 16\.'; then
  echo "Native PostgreSQL 16 psql is required at ${psql_bin}." >&2
  exit 1
fi
if [[ ! -x "${pg_dump_bin}" ]] || ! "${pg_dump_bin}" --version | grep -Eq '^pg_dump \(PostgreSQL\) 16\.'; then
  echo "Native PostgreSQL 16 pg_dump is required at ${pg_dump_bin}." >&2
  exit 1
fi
if [[ ! -x "${pg_restore_bin}" ]] || ! "${pg_restore_bin}" --version | grep -Eq '^pg_restore \(PostgreSQL\) 16\.'; then
  echo "Native PostgreSQL 16 pg_restore is required at ${pg_restore_bin}." >&2
  exit 1
fi

inventory_file="${script_root}/backup-object-inventory.txt"
toc_validator="${script_root}/validate-backup-toc.py"
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

if [[ "${dry_run}" == "1" ]]; then
  "${psql_bin}" --version
  "${pg_dump_bin}" --version
  "${pg_restore_bin}" --version
  echo "Strapi backup dry run passed with native PostgreSQL 16 clients; no backup files were created."
  exit 0
fi

if [[ -L "${media_root}" || ! -d "${media_root}" ]]; then
  echo "Required Strapi media root is missing: ${media_root}" >&2
  exit 1
fi
if [[ -L "${backup_root}" || ( -e "${backup_root}" && ! -d "${backup_root}" ) ]]; then
  echo "The exact backup root must be a real directory path." >&2
  exit 1
fi
install -d -m 0700 "${backup_root}"
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
final_dir="${backup_root}/${stamp}"
if [[ -e "${final_dir}" ]]; then
  echo "A Strapi backup already exists for ${stamp}." >&2
  exit 1
fi
partial_dir="$(mktemp -d "${backup_root}/.partial-${stamp}.XXXXXX")"
snapshot_pid=""
snapshot_read_fd=""
snapshot_write_fd=""
snapshot_transaction_open=0

close_file_descriptor() {
  descriptor="$1"
  if [[ "${descriptor}" =~ ^[0-9]+$ ]]; then
    eval "exec ${descriptor}>&-"
  fi
}

cleanup() {
  status="$?"
  trap - EXIT INT TERM
  set +e
  if [[ -n "${snapshot_pid:-}" ]]; then
    if [[ "${snapshot_transaction_open:-0}" == "1" && -n "${snapshot_write_fd:-}" ]]; then
      printf 'ROLLBACK;\n\\q\n' >&"${snapshot_write_fd}"
    fi
    close_file_descriptor "${snapshot_write_fd:-}"
    wait "${snapshot_pid}" >/dev/null 2>&1
    close_file_descriptor "${snapshot_read_fd:-}"
  fi
  if [[ -n "${partial_dir:-}" && -d "${partial_dir}" ]]; then
    rm -rf -- "${partial_dir}"
  fi
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

coproc AIC_BACKUP_SNAPSHOT_SESSION {
  PGCONNECT_TIMEOUT=5 \
  PGAPPNAME=aic-strapi-backup-snapshot \
  PGPASSWORD="${DATABASE_PASSWORD}" \
    "${psql_bin}" \
      --host "${DATABASE_HOST}" \
      --port "${DATABASE_PORT}" \
      --username "${DATABASE_USERNAME}" \
      --dbname "${DATABASE_NAME}" \
      --no-psqlrc \
      --quiet \
      --no-align \
      --tuples-only \
      --set=ON_ERROR_STOP=1 \
      2> "${partial_dir}/snapshot-session.stderr"
}
snapshot_pid="${AIC_BACKUP_SNAPSHOT_SESSION_PID}"
snapshot_read_fd="${AIC_BACKUP_SNAPSHOT_SESSION[0]}"
snapshot_write_fd="${AIC_BACKUP_SNAPSHOT_SESSION[1]}"
printf '%s\n' \
  'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;' \
  "SELECT 'AIC_SNAPSHOT:' || pg_export_snapshot();" \
  >&"${snapshot_write_fd}"
snapshot_transaction_open=1

snapshot_id=""
for _attempt in {1..10}; do
  if ! IFS= read -r -t 15 snapshot_line <&"${snapshot_read_fd}"; then
    break
  fi
  if [[ "${snapshot_line}" == AIC_SNAPSHOT:* ]]; then
    snapshot_id="${snapshot_line#AIC_SNAPSHOT:}"
    break
  fi
done
if [[ ! "${snapshot_id}" =~ ^[0-9A-Fa-f-]{1,128}$ ]]; then
  echo "Could not export the canonical read-only PostgreSQL snapshot." >&2
  exit 1
fi

common_dump_arguments=(
  --host "${DATABASE_HOST}"
  --port "${DATABASE_PORT}"
  --username "${DATABASE_USERNAME}"
  --dbname "${DATABASE_NAME}"
  --format=custom
  --no-owner
  --no-privileges
  --lock-wait-timeout=30s
  --snapshot="${snapshot_id}"
  --strict-names
)

if ! PGCONNECT_TIMEOUT=5 PGAPPNAME=aic-strapi-schema-backup PGPASSWORD="${DATABASE_PASSWORD}" \
  "${pg_dump_bin}" \
    "${common_dump_arguments[@]}" \
    --schema="${DATABASE_SCHEMA}" \
    --file="${partial_dir}/aic-strapi-schema.dump" \
    2> "${partial_dir}/schema-dump.stderr"; then
  echo "The aic_strapi schema archive could not be created." >&2
  exit 1
fi

public_dump_arguments=("${common_dump_arguments[@]}")
for relation in "${public_tables[@]}" "${public_sequences[@]}"; do
  public_dump_arguments+=(--table="${relation}")
done
if ! PGCONNECT_TIMEOUT=5 PGAPPNAME=aic-public-operational-backup PGPASSWORD="${DATABASE_PASSWORD}" \
  "${pg_dump_bin}" \
    "${public_dump_arguments[@]}" \
    --file="${partial_dir}/public-operational.dump" \
    2> "${partial_dir}/public-dump.stderr"; then
  echo "The public operational archive could not be created." >&2
  exit 1
fi

if ! printf 'ROLLBACK;\n\\q\n' >&"${snapshot_write_fd}"; then
  echo "The exported PostgreSQL snapshot session could not be closed cleanly." >&2
  exit 1
fi
snapshot_transaction_open=0
close_file_descriptor "${snapshot_write_fd}"
snapshot_write_fd=""
if ! wait "${snapshot_pid}"; then
  echo "The exported PostgreSQL snapshot session failed." >&2
  exit 1
fi
snapshot_pid=""
close_file_descriptor "${snapshot_read_fd}"
snapshot_read_fd=""
rm -f -- "${partial_dir}/snapshot-session.stderr" "${partial_dir}/schema-dump.stderr" "${partial_dir}/public-dump.stderr"

"${pg_restore_bin}" --list "${partial_dir}/aic-strapi-schema.dump" > "${partial_dir}/aic-strapi-schema.contents"
"${pg_restore_bin}" --list "${partial_dir}/public-operational.dump" > "${partial_dir}/public-operational.contents"
"${python_bin}" "${toc_validator}" schema "${partial_dir}/aic-strapi-schema.contents"
"${python_bin}" "${toc_validator}" public "${partial_dir}/public-operational.contents"

# Replaying the archive to /dev/null decompresses every archived object and data
# block without connecting to or restoring any database.
"${pg_restore_bin}" --exit-on-error --file=/dev/null "${partial_dir}/aic-strapi-schema.dump"
"${pg_restore_bin}" --exit-on-error --file=/dev/null "${partial_dir}/public-operational.dump"

tar --create --gzip --file "${partial_dir}/media.tar.gz" --directory "${media_root}" .
tar --list --gzip --file "${partial_dir}/media.tar.gz" > "${partial_dir}/media.contents"

public_tables_csv="$(IFS=,; printf '%s' "${public_tables[*]}")"
public_sequences_csv="$(IFS=,; printf '%s' "${public_sequences[*]}")"

{
  printf 'format_version=2\n'
  printf 'created_at=%s\n' "${stamp}"
  printf 'database_host=%s\n' "${DATABASE_HOST}"
  printf 'database_port=%s\n' "${DATABASE_PORT}"
  printf 'database_name=%s\n' "${DATABASE_NAME}"
  printf 'database_schema=%s\n' "${DATABASE_SCHEMA}"
  printf 'snapshot_id=%s\n' "${snapshot_id}"
  printf 'snapshot_isolation=repeatable-read\n'
  printf 'snapshot_read_only=true\n'
  printf 'schema_archive=aic-strapi-schema.dump\n'
  printf 'public_archive=public-operational.dump\n'
  printf 'public_tables=%s\n' "${public_tables_csv}"
  printf 'public_sequences=%s\n' "${public_sequences_csv}"
  printf 'media_root=%s\n' "${media_root}"
  printf 'postgres_client_major=16\n'
} > "${partial_dir}/manifest.env"

(
  cd "${partial_dir}"
  sha256sum \
    aic-strapi-schema.dump \
    aic-strapi-schema.contents \
    public-operational.dump \
    public-operational.contents \
    media.tar.gz \
    media.contents \
    manifest.env \
    > SHA256SUMS
  sha256sum --check SHA256SUMS
)

mv -- "${partial_dir}" "${final_dir}"
partial_dir=""

find "${backup_root}"   -mindepth 1   -maxdepth 1   -type d   -name '20??-??-??T??????Z'   -mtime "+${retention_days}"   -exec rm -rf -- {} +

echo "Verified Strapi backup created: ${final_dir}"
