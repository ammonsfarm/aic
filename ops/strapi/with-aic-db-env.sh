#!/usr/bin/env bash
set -euo pipefail
umask 077

canonical_aic_env="/mnt/storage/aic/.env"
aic_env="${STRAPI_AIC_ENV_FILE:-${canonical_aic_env}}"
test_mode="${STRAPI_DATABASE_ENV_TEST_MODE:-0}"

case "${test_mode}" in
  0|1) ;;
  *)
    echo "STRAPI_DATABASE_ENV_TEST_MODE must be 0 or 1." >&2
    exit 1
    ;;
esac
if [[ "${test_mode}" == "1" && "${NODE_ENV:-}" == "production" ]]; then
  echo "Test database environment overrides are forbidden in production." >&2
  exit 1
fi

if [[ "${test_mode}" == "0" && "${aic_env}" != "${canonical_aic_env}" ]]; then
  echo "Production Strapi must use ${canonical_aic_env}." >&2
  exit 1
fi
if [[ ! -f "${aic_env}" ]]; then
  echo "Canonical AIC database environment is missing: ${aic_env}" >&2
  exit 1
fi
if [[ "$#" -eq 0 ]]; then
  echo "A command is required." >&2
  exit 1
fi

# Load only the five database values in a subshell. Other assignments in the AIC
# file must not overwrite NODE_ENV, Strapi application secrets, or service paths.
database_values=()
mapfile -d '' -t database_values < <(
  (
    set -euo pipefail
    unset DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD
    # shellcheck disable=SC1090
    source "${aic_env}" >/dev/null
    for variable in DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD; do
      if [[ -z "${!variable:-}" ]]; then
        echo "${variable} is required in ${aic_env}." >&2
        exit 1
      fi
    done
    printf '%s\0' "${DB_HOST}" "${DB_PORT}" "${DB_NAME}" "${DB_USER}" "${DB_PASSWORD}"
  )
)
if [[ "${#database_values[@]}" -ne 5 ]]; then
  echo "Could not load the five required database values from ${aic_env}." >&2
  exit 1
fi

unset DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD
DB_HOST="${database_values[0]}"
DB_PORT="${database_values[1]}"
DB_NAME="${database_values[2]}"
DB_USER="${database_values[3]}"
DB_PASSWORD="${database_values[4]}"
if [[ "${DB_HOST}" != "192.168.1.106" || "${DB_PORT}" != "5432" ]]; then
  echo "Strapi must use the existing AIC PostgreSQL target at 192.168.1.106:5432." >&2
  exit 1
fi

# DATABASE_URL is intentionally unsupported: it could silently repoint Strapi
# away from the exact AIC PostgreSQL target above.
unset DATABASE_URL
# libpq accepts independent address and service-file routing overrides. Remove
# them before exporting the exact canonical host, database, user, and password.
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGPASSFILE
export DATABASE_CLIENT=postgres
export DATABASE_HOST="${DB_HOST}"
export DATABASE_PORT="${DB_PORT}"
export DATABASE_NAME="${DB_NAME}"
export DATABASE_USERNAME="${DB_USER}"
export DATABASE_PASSWORD="${DB_PASSWORD}"
export DATABASE_SCHEMA=aic_strapi
export DATABASE_SSL=false
export DATABASE_POOL_MIN=1
export DATABASE_POOL_MAX=10
export DATABASE_CONNECTION_TIMEOUT=60000
export PGHOST="${DB_HOST}"
export PGPORT="${DB_PORT}"
export PGDATABASE="${DB_NAME}"
export PGUSER="${DB_USER}"
export PGPASSWORD="${DB_PASSWORD}"
export PGCONNECT_TIMEOUT=5

exec "$@"
