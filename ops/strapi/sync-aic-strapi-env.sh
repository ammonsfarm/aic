#!/usr/bin/env bash
set -euo pipefail
umask 077

test_mode="${AIC_STRAPI_ENV_SYNC_TEST_MODE:-0}"
case "${test_mode}" in
  0|1) ;;
  *)
    echo "AIC_STRAPI_ENV_SYNC_TEST_MODE must be 0 or 1." >&2
    exit 1
    ;;
esac

if [[ "${test_mode}" == "0" ]]; then
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Run this environment sync as root." >&2
    exit 1
  fi
  aic_env="${AIC_ENV_FILE:-/mnt/storage/aic/.env}"
  token_file="${AIC_API_TOKEN_FILE:-/run/aic-strapi/aic-api-token}"
  strapi_env="${STRAPI_ENV_FILE:-/etc/aic/strapi.env}"
  lock_file="/run/lock/aic-strapi-env-sync.lock"
  target_uid="$(id -u ammonsfarm)"
  target_gid="$(id -g ammonsfarm)"
  lock_uid=0
  lock_gid=0
  if [[ "${aic_env}" != "/mnt/storage/aic/.env" ||
        "${token_file}" != "/run/aic-strapi/aic-api-token" ||
        "${strapi_env}" != "/etc/aic/strapi.env" ]]; then
    echo "Refusing unexpected AIC environment, Strapi environment, or token path." >&2
    exit 1
  fi
else
  if [[ "${NODE_ENV:-}" != "test" ]]; then
    echo "The Strapi environment sync test mode requires NODE_ENV=test." >&2
    exit 1
  fi
  test_root="${AIC_STRAPI_ENV_SYNC_TEST_ROOT:-}"
  if [[ -z "${test_root}" || ! -d "${test_root}" || -L "${test_root}" ]]; then
    echo "The Strapi environment sync test root must be a real directory." >&2
    exit 1
  fi
  test_root="$(readlink -m -- "${test_root}")"
  if [[ "${test_root}" != /tmp/aic-strapi-env-sync-test-* ]]; then
    echo "The Strapi environment sync test root must use its dedicated /tmp prefix." >&2
    exit 1
  fi
  aic_env="${AIC_ENV_FILE:-}"
  token_file="${AIC_API_TOKEN_FILE:-}"
  strapi_env="${STRAPI_ENV_FILE:-}"
  lock_file="${AIC_STRAPI_ENV_SYNC_LOCK_FILE:-}"
  for test_path in "${aic_env}" "${token_file}" "${strapi_env}" "${lock_file}"; do
    if [[ -z "${test_path}" || "$(readlink -m -- "${test_path}")" != "${test_root}"/* ]]; then
      echo "All Strapi environment sync test paths must stay inside the test root." >&2
      exit 1
    fi
  done
  target_uid="$(id -u)"
  target_gid="$(id -g)"
  lock_uid="${target_uid}"
  lock_gid="${target_gid}"
fi
command -v flock >/dev/null
if [[ -L "${lock_file}" || ( -e "${lock_file}" && ! -f "${lock_file}" ) ]]; then
  echo "Refusing a non-regular Strapi environment synchronization lock." >&2
  exit 1
fi
exec 9>>"${lock_file}"
if [[ "$(stat -c '%u:%g:%a' "${lock_file}")" != "${lock_uid}:${lock_gid}:600" ]]; then
  echo "Strapi environment synchronization lock has an unexpected owner or mode." >&2
  exit 1
fi
flock -x 9
if [[ "${test_mode}" == "1" && -n "${AIC_STRAPI_ENV_SYNC_TEST_READY_FILE:-}" ]]; then
  ready_file="$(readlink -m -- "${AIC_STRAPI_ENV_SYNC_TEST_READY_FILE}")"
  release_file="$(readlink -m -- "${AIC_STRAPI_ENV_SYNC_TEST_RELEASE_FILE:-}")"
  if [[ "${ready_file}" != "${test_root}"/* || "${release_file}" != "${test_root}"/* ]]; then
    echo "Strapi environment sync test coordination paths must stay inside the test root." >&2
    exit 1
  fi
  : > "${ready_file}"
  acquired_release=0
  for _attempt in {1..500}; do
    if [[ -f "${release_file}" && ! -L "${release_file}" ]]; then
      acquired_release=1
      break
    fi
    sleep 0.01
  done
  if [[ "${acquired_release}" != "1" ]]; then
    echo "Timed out waiting for the Strapi environment sync test release." >&2
    exit 1
  fi
fi
if [[ -L "${aic_env}" || -L "${token_file}" || -L "${strapi_env}" ||
      ! -f "${aic_env}" || ! -f "${token_file}" || ! -f "${strapi_env}" ]]; then
  echo "AIC environment, private Strapi environment, and generated Strapi token must exist." >&2
  exit 1
fi

token="$(tr -d '\r\n' < "${token_file}")"
if [[ ! "${token}" =~ ^[0-9a-f]{256}$ ]]; then
  echo "Generated Strapi token has an unexpected format." >&2
  exit 1
fi

revalidation_secret_count="$(grep -Ec '^STRAPI_REVALIDATE_SECRET=' "${strapi_env}" || true)"
if [[ "${revalidation_secret_count}" != "1" ]]; then
  echo "Private Strapi environment must contain exactly one cache-revalidation secret." >&2
  exit 1
fi
revalidation_secret="$(sed -n 's/^STRAPI_REVALIDATE_SECRET=//p' "${strapi_env}")"
if [[ ! "${revalidation_secret}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Private cache-revalidation secret has an unexpected format." >&2
  exit 1
fi

temporary_env="$(mktemp "${aic_env}.strapi-sync.XXXXXX")"
db_before="$(mktemp /tmp/.aic-db-before.XXXXXX)"
db_candidate="$(mktemp /tmp/.aic-db-candidate.XXXXXX)"
db_after="$(mktemp /tmp/.aic-db-after.XXXXXX)"
cleanup() {
  rm -f -- "${temporary_env:-}"
  rm -f -- "${db_before:-}" "${db_candidate:-}" "${db_after:-}"
}
trap cleanup EXIT

snapshot_database_lines() {
  source_file="$1"
  destination="$2"
  for key in DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD; do
    if [[ "$(grep -Ec "^${key}=" "${source_file}" || true)" != "1" ]]; then
      echo "Canonical AIC environment must contain exactly one ${key} entry." >&2
      return 1
    fi
  done
  grep -E '^DB_(HOST|PORT|NAME|USER|PASSWORD)=' "${source_file}" > "${destination}"
}

snapshot_database_lines "${aic_env}" "${db_before}"
grep -Ev '^STRAPI_(URL|MANAGEMENT_URL|PUBLIC_URL|API_TOKEN|READ_TOKEN|MANAGEMENT_TOKEN|API_TOKEN_TEMP_WRITE|REVALIDATE_SECRET)=' \
  "${aic_env}" > "${temporary_env}" || true
{
  printf 'STRAPI_URL=http://127.0.0.1:1337\n'
  printf 'STRAPI_MANAGEMENT_URL=http://127.0.0.1:1337\n'
  printf 'STRAPI_PUBLIC_URL=http://127.0.0.1:1337\n'
  printf 'STRAPI_API_TOKEN=%s\n' "${token}"
  printf 'STRAPI_REVALIDATE_SECRET=%s\n' "${revalidation_secret}"
} >> "${temporary_env}"

snapshot_database_lines "${temporary_env}" "${db_candidate}"
if ! cmp --silent "${db_before}" "${db_candidate}"; then
  echo "Refusing to synchronize Strapi settings because database entries changed." >&2
  exit 1
fi
if [[ "${test_mode}" == "0" ]]; then
  chown "${target_uid}:${target_gid}" "${temporary_env}"
fi
chmod 0600 "${temporary_env}"
mv -f -- "${temporary_env}" "${aic_env}"
temporary_env=""
snapshot_database_lines "${aic_env}" "${db_after}"
if ! cmp --silent "${db_before}" "${db_after}"; then
  echo "Database entries changed during Strapi environment synchronization." >&2
  exit 1
fi
trap - EXIT
cleanup

echo "Configured AIC to use the private Strapi service."
