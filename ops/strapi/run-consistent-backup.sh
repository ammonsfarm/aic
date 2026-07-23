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
  "${ops_root}/backup-strapi.sh" \
  "${ops_root}/sync-aic-strapi-env.sh"; do
  if [[ ! -x "${required}" ]]; then
    echo "Required backup command is missing or not executable: ${required}" >&2
    exit 1
  fi
done

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
      elif ! "${ops_root}/sync-aic-strapi-env.sh"; then
        echo "Strapi restarted but its managed AIC token could not be synchronized." >&2
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
