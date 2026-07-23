#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run the coordinated Strapi backup as root." >&2
  exit 1
fi

ops_root="/usr/local/libexec/aic-strapi"
strapi_service="aic-strapi.service"
service_was_active=0

for required in \
  "${ops_root}/with-aic-db-env.sh" \
  "${ops_root}/backup-strapi.sh"; do
  if [[ ! -x "${required}" ]]; then
    echo "Required backup command is missing or not executable: ${required}" >&2
    exit 1
  fi
done

verify_managed_token_sync() {
  local aic_env="/mnt/storage/aic/.env"
  local token_file="/run/aic-strapi/aic-api-token"
  local runtime_token configured_token
  if [[ -L "${aic_env}" || -L "${token_file}" ||
        ! -f "${aic_env}" || ! -f "${token_file}" ]]; then
    echo "Canonical AIC environment and managed Strapi token must be regular files." >&2
    return 1
  fi
  if [[ "$(grep -Ec '^STRAPI_API_TOKEN=' "${aic_env}" || true)" != "1" ]]; then
    echo "Canonical AIC environment must contain exactly one managed Strapi token." >&2
    return 1
  fi
  runtime_token="$(tr -d '\r\n' < "${token_file}")"
  configured_token="$(sed -n 's/^STRAPI_API_TOKEN=//p' "${aic_env}")"
  if [[ ! "${runtime_token}" =~ ^[0-9a-f]{256}$ ||
        "${configured_token}" != "${runtime_token}" ]]; then
    echo "Managed Strapi token no longer matches the canonical AIC environment." >&2
    return 1
  fi
}

restart_strapi() {
  status="$1"
  trap - EXIT INT TERM
  if [[ "${service_was_active}" == "1" ]]; then
    if ! systemctl start "${strapi_service}"; then
      echo "Strapi backup finished but ${strapi_service} could not be restarted." >&2
      status=1
    else
      ready=0
      for _ in $(seq 1 60); do
        if curl --fail --silent --show-error http://127.0.0.1:1337/_health >/dev/null 2>&1 &&
           [[ -s /run/aic-strapi/aic-api-token ]]; then
          ready=1
          break
        fi
        sleep 2
      done
      if [[ "${ready}" != "1" ]]; then
        echo "${strapi_service} restarted but did not become ready." >&2
        status=1
      elif ! verify_managed_token_sync; then
        echo "Strapi restarted but its managed AIC token could not be verified." >&2
        status=1
      fi
    fi
  fi
  exit "${status}"
}
trap 'restart_strapi $?' EXIT
trap 'restart_strapi 130' INT
trap 'restart_strapi 143' TERM

if systemctl is-active --quiet "${strapi_service}"; then
  service_was_active=1
  systemctl stop "${strapi_service}"
fi

# The wrapper reads only the five canonical DB values after privileges are
# dropped. backup-strapi.sh exports one read-only REPEATABLE READ snapshot for
# both custom archives. Public operational writes continue while the snapshot
# is held; Strapi stays stopped through both dumps and the media tar.
runuser --user ammonsfarm -- \
  "${ops_root}/with-aic-db-env.sh" \
  "${ops_root}/backup-strapi.sh"

echo "Created coordinated Strapi and public-operational snapshot archives with Strapi media quiesced."
