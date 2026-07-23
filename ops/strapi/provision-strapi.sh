#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this provisioning script as root." >&2
  exit 1
fi

ops_root="${STRAPI_OPS_ROOT:-/usr/local/libexec/aic-strapi}"
env_file="${STRAPI_ENV_FILE:-/etc/aic/strapi.env}"
secrets_backup="${STRAPI_SECRETS_BACKUP:-/mnt/storage/backups/aic-strapi-secrets}"
cms_tmp_root="/mnt/storage/aic/services/jimwood-cms/.tmp"
media_root="/mnt/storage/pastorwood-media/strapi"
backup_root="/mnt/storage/backups/aic-strapi"

if [[ "${ops_root}" != "/usr/local/libexec/aic-strapi" ||
      "${env_file}" != "/etc/aic/strapi.env" ||
      "${secrets_backup}" != "/mnt/storage/backups/aic-strapi-secrets" ]]; then
  echo "Refusing unexpected Strapi repository, environment, or secrets-backup path." >&2
  exit 1
fi

command -v openssl >/dev/null
test -x "${ops_root}/with-aic-db-env.sh"
test -x "${ops_root}/ensure-strapi-schema.sh"

random_hex() {
  openssl rand -hex "$1"
}

install -d -o root -g root -m 0750 /etc/aic

if [[ -e "${env_file}" ]]; then
  if [[ ! -f "${env_file}" ]] || [[ "$(stat -c '%U:%G:%a' "${env_file}")" != "root:root:600" ]]; then
    echo "Existing ${env_file} must be a root-owned mode-0600 regular file." >&2
    exit 1
  fi
else
  APP_KEYS="$(random_hex 32),$(random_hex 32),$(random_hex 32),$(random_hex 32)"
  API_TOKEN_SALT="$(random_hex 32)"
  ADMIN_JWT_SECRET="$(random_hex 32)"
  TRANSFER_TOKEN_SALT="$(random_hex 32)"
  ENCRYPTION_KEY="$(random_hex 16)"
  STRAPI_REVALIDATE_SECRET="$(random_hex 32)"

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
    printf 'ENCRYPTION_KEY=%s\n' "${ENCRYPTION_KEY}"
    printf 'STRAPI_REVALIDATE_SECRET=%s\n' "${STRAPI_REVALIDATE_SECRET}"
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

revalidation_secret_count="$(grep -Ec '^STRAPI_REVALIDATE_SECRET=' "${env_file}" || true)"
if [[ "${revalidation_secret_count}" -gt 1 ]]; then
  echo "Existing ${env_file} contains duplicate cache-revalidation secrets." >&2
  exit 1
fi
if [[ "${revalidation_secret_count}" == "0" ]]; then
  STRAPI_REVALIDATE_SECRET="$(random_hex 32)"
  temporary_env="$(mktemp /etc/aic/.strapi.env.XXXXXX)"
  cleanup_env() {
    rm -f -- "${temporary_env:-}"
  }
  trap cleanup_env EXIT
  {
    cat "${env_file}"
    printf '\nSTRAPI_REVALIDATE_SECRET=%s\n' "${STRAPI_REVALIDATE_SECRET}"
  } > "${temporary_env}"
  chown root:root "${temporary_env}"
  chmod 0600 "${temporary_env}"
  mv -f -- "${temporary_env}" "${env_file}"
  temporary_env=""
  trap - EXIT
fi

# This file contains only generated Strapi application secrets and runtime
# settings. Database credentials remain exclusively in /mnt/storage/aic/.env.
if grep -Eq '^(DB_|DATABASE_)' "${env_file}"; then
  echo "${env_file} must not contain database credentials or targets." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${env_file}"
: "${APP_KEYS:?APP_KEYS is required}"
: "${API_TOKEN_SALT:?API_TOKEN_SALT is required}"
: "${ADMIN_JWT_SECRET:?ADMIN_JWT_SECRET is required}"
: "${TRANSFER_TOKEN_SALT:?TRANSFER_TOKEN_SALT is required}"
: "${ENCRYPTION_KEY:?ENCRYPTION_KEY is required}"
: "${STRAPI_REVALIDATE_SECRET:?STRAPI_REVALIDATE_SECRET is required}"

if [[ ! "${APP_KEYS}" =~ ^[0-9a-f]{64},[0-9a-f]{64},[0-9a-f]{64},[0-9a-f]{64}$ ||
      ! "${API_TOKEN_SALT}" =~ ^[0-9a-f]{64}$ ||
      ! "${ADMIN_JWT_SECRET}" =~ ^[0-9a-f]{64}$ ||
      ! "${TRANSFER_TOKEN_SALT}" =~ ^[0-9a-f]{64}$ ||
      ! "${ENCRYPTION_KEY}" =~ ^[0-9a-f]{32}$ ||
      ! "${STRAPI_REVALIDATE_SECRET}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Existing Strapi application secrets do not match the generated secret format." >&2
  exit 1
fi
if [[ "${STRAPI_MEDIA_ROOT:-}" != "${media_root}/uploads" ||
      "${STRAPI_BACKUP_ROOT:-}" != "${backup_root}" ]]; then
  echo "Existing Strapi storage settings do not match the farm production contract." >&2
  exit 1
fi

# systemd resolves ReadWritePaths before ExecStartPre. Create every writable
# namespace target during provisioning so the first service start cannot fail.
install -d -o ammonsfarm -g ammonsfarm -m 0750 \
  "${cms_tmp_root}" \
  "${media_root}" \
  "${media_root}/uploads" \
  "${backup_root}"

install -d -o root -g root -m 0700 "${secrets_backup}"
install -o root -g root -m 0600 "${env_file}" "${secrets_backup}/strapi.env"
(
  cd "${secrets_backup}"
  sha256sum strapi.env > SHA256SUMS
  chown root:root SHA256SUMS
  chmod 0600 SHA256SUMS
  sha256sum --check SHA256SUMS
)

echo "Provisioned private Strapi application secrets; service startup will prepare only the aic_strapi schema."
