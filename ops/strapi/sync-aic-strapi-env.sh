#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this environment sync as root." >&2
  exit 1
fi

aic_env="${AIC_ENV_FILE:-/mnt/storage/aic/.env}"
token_file="${AIC_API_TOKEN_FILE:-/run/aic-strapi/aic-api-token}"

if [[ "${aic_env}" != "/mnt/storage/aic/.env" || "${token_file}" != "/run/aic-strapi/aic-api-token" ]]; then
  echo "Refusing unexpected AIC environment or token path." >&2
  exit 1
fi
if [[ ! -f "${aic_env}" || ! -f "${token_file}" ]]; then
  echo "AIC environment and generated Strapi token must both exist." >&2
  exit 1
fi

token="$(tr -d '\r\n' < "${token_file}")"
if [[ ! "${token}" =~ ^[0-9a-f]{256}$ ]]; then
  echo "Generated Strapi token has an unexpected format." >&2
  exit 1
fi

temporary_env="$(mktemp /mnt/storage/aic/.env.strapi.XXXXXX)"
cleanup() {
  rm -f -- "${temporary_env:-}"
}
trap cleanup EXIT

grep -Ev '^STRAPI_(URL|MANAGEMENT_URL|PUBLIC_URL|API_TOKEN|READ_TOKEN|MANAGEMENT_TOKEN|API_TOKEN_TEMP_WRITE)=' \
  "${aic_env}" > "${temporary_env}" || true
{
  printf 'STRAPI_URL=http://127.0.0.1:1337\n'
  printf 'STRAPI_MANAGEMENT_URL=http://127.0.0.1:1337\n'
  printf 'STRAPI_PUBLIC_URL=http://127.0.0.1:1337\n'
  printf 'STRAPI_API_TOKEN=%s\n' "${token}"
} >> "${temporary_env}"

install -o ammonsfarm -g ammonsfarm -m 0600 "${temporary_env}" "${aic_env}"
rm -f -- "${temporary_env}"
trap - EXIT

echo "Configured AIC to use the private Strapi service."
