#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DATABASE_HOST:?DATABASE_HOST is required}"
: "${DATABASE_PORT:?DATABASE_PORT is required}"
: "${DATABASE_NAME:?DATABASE_NAME is required}"
: "${DATABASE_USERNAME:?DATABASE_USERNAME is required}"
: "${DATABASE_PASSWORD:?DATABASE_PASSWORD is required}"
: "${DATABASE_SCHEMA:?DATABASE_SCHEMA is required}"

script_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck disable=SC1091
source "${script_root}/require-canonical-db-context.sh"

canonical_client_root="/usr/lib/postgresql/16/bin"
client_root="${STRAPI_POSTGRES_CLIENT_ROOT:-${canonical_client_root}}"
client_test_mode="${STRAPI_NATIVE_CLIENT_TEST_MODE:-0}"
if [[ "${client_test_mode}" != "0" && "${client_test_mode}" != "1" ]]; then
  echo "STRAPI_NATIVE_CLIENT_TEST_MODE must be 0 or 1." >&2
  exit 1
fi
if [[ "${client_test_mode}" == "1" && "${NODE_ENV:-}" == "production" ]]; then
  echo "Native client test overrides are forbidden in production." >&2
  exit 1
fi
if [[ "${client_test_mode}" == "0" && "${client_root}" != "${canonical_client_root}" ]]; then
  echo "Production schema preparation requires PostgreSQL 16 clients at ${canonical_client_root}." >&2
  exit 1
fi
psql_bin="${client_root}/psql"
if [[ ! -x "${psql_bin}" ]] || ! "${psql_bin}" --version | grep -Eq '^psql \(PostgreSQL\) 16\.'; then
  echo "Native PostgreSQL 16 psql is required at ${psql_bin}." >&2
  exit 1
fi

PGCONNECT_TIMEOUT=5 \
PGOPTIONS='-c statement_timeout=60000 -c lock_timeout=30000' \
PGPASSWORD="${DATABASE_PASSWORD}" \
  "${psql_bin}" \
    --no-password \
    --no-psqlrc \
    --set ON_ERROR_STOP=1 \
  --host "${DATABASE_HOST}" \
  --port "${DATABASE_PORT}" \
  --username "${DATABASE_USERNAME}" \
    --dbname "${DATABASE_NAME}" \
    --command "CREATE SCHEMA IF NOT EXISTS ${DATABASE_SCHEMA} AUTHORIZATION CURRENT_USER; DO \$\$ DECLARE actual_owner name; BEGIN SELECT pg_get_userbyid(nspowner) INTO actual_owner FROM pg_namespace WHERE nspname = '${DATABASE_SCHEMA}'; IF actual_owner IS DISTINCT FROM current_user THEN RAISE EXCEPTION 'Schema ${DATABASE_SCHEMA} is owned by %, expected %', actual_owner, current_user; END IF; END \$\$; REVOKE ALL ON SCHEMA ${DATABASE_SCHEMA} FROM PUBLIC; GRANT USAGE, CREATE ON SCHEMA ${DATABASE_SCHEMA} TO CURRENT_USER;"

echo "Prepared the aic_strapi schema in the existing AIC PostgreSQL database."
