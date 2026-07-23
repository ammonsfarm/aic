#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this service installer as root." >&2
  exit 1
fi

repo_root="${AIC_REPO_ROOT:-/mnt/storage/aic}"
ops_root="${STRAPI_OPS_ROOT:-/usr/local/libexec/aic-strapi}"
env_file="/etc/aic/strapi.env"

if [[ "${repo_root}" != "/mnt/storage/aic" ||
      "${ops_root}" != "/usr/local/libexec/aic-strapi" ||
      ! -d "${repo_root}/services/jimwood-cms" ]]; then
  echo "Refusing unexpected or incomplete AIC repository root: ${repo_root}" >&2
  exit 1
fi
if [[ ! -f "${env_file}" || "$(stat -c '%U:%G:%a' "${env_file}")" != "root:root:600" ]]; then
  echo "Provision ${env_file} as root:root mode 0600 before installing Strapi." >&2
  exit 1
fi
if grep -Eq '^(DB_|DATABASE_)' "${env_file}"; then
  echo "${env_file} must contain Strapi application secrets only." >&2
  exit 1
fi
test -x "${ops_root}/with-aic-db-env.sh"
test -x "${ops_root}/ensure-strapi-schema.sh"
test -x "${ops_root}/run-consistent-backup.sh"

install -o root -g root -m 0644 \
  "${ops_root}/systemd/aic-strapi-schema.service" \
  /etc/systemd/system/aic-strapi-schema.service
install -o root -g root -m 0644 \
  "${ops_root}/systemd/aic-strapi.service" \
  /etc/systemd/system/aic-strapi.service
install -o root -g root -m 0644 \
  "${ops_root}/systemd/aic-strapi-backup.service" \
  /etc/systemd/system/aic-strapi-backup.service
install -o root -g root -m 0644 \
  "${ops_root}/systemd/aic-strapi-backup.timer" \
  /etc/systemd/system/aic-strapi-backup.timer

systemctl daemon-reload
systemctl enable aic-strapi.service aic-strapi-backup.timer >/dev/null
systemctl restart aic-strapi-schema.service
systemctl restart aic-strapi.service

for _ in $(seq 1 60); do
  if curl --fail --silent --show-error http://127.0.0.1:1337/_health >/dev/null &&
     [[ -s /run/aic-strapi/aic-api-token ]]; then
    break
  fi
  sleep 2
done

curl --fail --silent --show-error http://127.0.0.1:1337/_health >/dev/null
test -s /run/aic-strapi/aic-api-token
"${ops_root}/sync-aic-strapi-env.sh"
systemctl start aic-strapi-backup.timer
systemctl is-active --quiet aic-strapi.service
systemctl is-active --quiet aic-strapi-backup.timer

if ss -ltnH 'sport = :1337' | awk '{print $4}' | grep -Ev '^(127\.0\.0\.1|\[::1\]):1337$' | grep -q .; then
  echo "Strapi port 1337 is listening beyond loopback." >&2
  exit 1
fi

echo "Installed and verified the private Strapi service and backup timer."
