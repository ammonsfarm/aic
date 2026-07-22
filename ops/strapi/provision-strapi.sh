#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this provisioning script as root." >&2
  exit 1
fi

env_file="${STRAPI_ENV_FILE:-/etc/aic/strapi.env}"
postgres_container="${STRAPI_POSTGRES_CONTAINER:-farm-postgres}"
database_name="aic_strapi"
database_role="aic_strapi"

if [[ "${env_file}" != "/etc/aic/strapi.env" ]]; then
  echo "Refusing unexpected Strapi environment path: ${env_file}" >&2
  exit 1
fi

command -v openssl >/dev/null
command -v docker >/dev/null
docker inspect "${postgres_container}" >/dev/null

random_hex() {
  openssl rand -hex "$1"
}

install -d -o root -g root -m 0750 /etc/aic

if [[ -e "${env_file}" ]]; then
  if [[ ! -f "${env_file}" ]] || [[ "$(stat -c '%U:%G:%a' "${env_file}")" != "root:root:600" ]]; then
    echo "Existing ${env_file} must be a root-owned mode-0600 regular file." >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "${env_file}"
else
  APP_KEYS="$(random_hex 32),$(random_hex 32),$(random_hex 32),$(random_hex 32)"
  API_TOKEN_SALT="$(random_hex 32)"
  ADMIN_JWT_SECRET="$(random_hex 32)"
  TRANSFER_TOKEN_SALT="$(random_hex 32)"
  JWT_SECRET="$(random_hex 32)"
  ENCRYPTION_KEY="$(random_hex 16)"
  DATABASE_PASSWORD="$(random_hex 32)"

  temporary_env="$(mktemp /etc/aic/.strapi.env.XXXXXX)"
  cleanup_env() {
    rm -f -- "${temporary_env:-}"
  }
  trap cleanup_env EXIT

  {
    printf 'HOST=127.0.0.1\n'
    printf 'PORT=1337\n'
    printf 'PUBLIC_URL=\n'
    printf 'APP_KEYS=%s\n' "${APP_KEYS}"
    printf 'API_TOKEN_SALT=%s\n' "${API_TOKEN_SALT}"
    printf 'ADMIN_JWT_SECRET=%s\n' "${ADMIN_JWT_SECRET}"
    printf 'TRANSFER_TOKEN_SALT=%s\n' "${TRANSFER_TOKEN_SALT}"
    printf 'JWT_SECRET=%s\n' "${JWT_SECRET}"
    printf 'ENCRYPTION_KEY=%s\n' "${ENCRYPTION_KEY}"
    printf 'DATABASE_CLIENT=postgres\n'
    printf 'DATABASE_HOST=127.0.0.1\n'
    printf 'DATABASE_PORT=5433\n'
    printf 'DATABASE_NAME=%s\n' "${database_name}"
    printf 'DATABASE_USERNAME=%s\n' "${database_role}"
    printf 'DATABASE_PASSWORD=%s\n' "${DATABASE_PASSWORD}"
    printf 'DATABASE_SCHEMA=public\n'
    printf 'DATABASE_SSL=false\n'
    printf 'DATABASE_POOL_MIN=1\n'
    printf 'DATABASE_POOL_MAX=10\n'
    printf 'DATABASE_CONNECTION_TIMEOUT=60000\n'
    printf 'UPLOAD_MAX_FILE_SIZE=268435456\n'
    printf 'FLAG_NPS=false\n'
    printf 'FLAG_PROMOTE_EE=false\n'
    printf 'FLAG_DOC_LINKS=false\n'
    printf 'STRAPI_MEDIA_ROOT=/mnt/storage/pastorwood-media/strapi/uploads\n'
    printf 'STRAPI_BACKUP_ROOT=/mnt/storage/backups/aic-strapi\n'
    printf 'STRAPI_BACKUP_RETENTION_DAYS=30\n'
  } > "${temporary_env}"

  install -o root -g root -m 0600 "${temporary_env}" "${env_file}"
  rm -f -- "${temporary_env}"
  trap - EXIT
fi

# Re-read the canonical file so first-run and idempotent validation use the
# exact persisted values rather than transient shell state.
source "${env_file}"
: "${DATABASE_CLIENT:?DATABASE_CLIENT is required}"
: "${DATABASE_HOST:?DATABASE_HOST is required}"
: "${DATABASE_PORT:?DATABASE_PORT is required}"
: "${DATABASE_NAME:?DATABASE_NAME is required}"
: "${DATABASE_USERNAME:?DATABASE_USERNAME is required}"
: "${DATABASE_PASSWORD:?DATABASE_PASSWORD is required}"

if [[ "${DATABASE_CLIENT}" != "postgres" || "${DATABASE_HOST}" != "127.0.0.1" ||
      "${DATABASE_PORT}" != "5433" || "${DATABASE_NAME}" != "${database_name}" ||
      "${DATABASE_USERNAME}" != "${database_role}" ]]; then
  echo "Existing Strapi database settings do not match the farm production contract." >&2
  exit 1
fi
if [[ ! "${DATABASE_PASSWORD}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Strapi database password does not match the generated secret format." >&2
  exit 1
fi

{
  printf "SELECT format('CREATE ROLE %%I LOGIN PASSWORD %%L', '%s', '%s') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%s') \\gexec\n" \
    "${database_role}" "${DATABASE_PASSWORD}" "${database_role}"
  printf "ALTER ROLE %s WITH LOGIN PASSWORD '%s' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;\n" \
    "${database_role}" "${DATABASE_PASSWORD}"
  printf "SELECT format('CREATE DATABASE %%I OWNER %%I', '%s', '%s') WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '%s') \\gexec\n" \
    "${database_name}" "${database_role}" "${database_name}"
  printf "REVOKE ALL ON DATABASE %s FROM PUBLIC;\n" "${database_name}"
  printf "GRANT CONNECT, TEMPORARY ON DATABASE %s TO %s;\n" "${database_name}" "${database_role}"
} | docker exec -i "${postgres_container}" sh -lc \
  'psql -X --set ON_ERROR_STOP=1 --quiet -U "$POSTGRES_USER" -d postgres'

echo "Provisioned private Strapi configuration and isolated PostgreSQL database."
