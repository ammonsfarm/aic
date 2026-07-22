#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this service installer as root." >&2
  exit 1
fi

repo_root="${AIC_REPO_ROOT:-/mnt/storage/aic}"
env_file="/etc/aic/strapi.env"

if [[ "${repo_root}" != "/mnt/storage/aic" || ! -d "${repo_root}/services/jimwood-cms" ]]; then
  echo "Refusing unexpected or incomplete AIC repository root: ${repo_root}" >&2
  exit 1
fi
if [[ ! -f "${env_file}" || "$(stat -c '%U:%G:%a' "${env_file}")" != "root:root:600" ]]; then
  echo "Provision ${env_file} as root:root mode 0600 before installing Strapi." >&2
  exit 1
fi

install -o root -g root -m 0644 \
  "${repo_root}/ops/strapi/systemd/aic-strapi.service" \
  /etc/systemd/system/aic-strapi.service
install -o root -g root -m 0644 \
  "${repo_root}/ops/strapi/systemd/aic-strapi-backup.service" \
  /etc/systemd/system/aic-strapi-backup.service
install -o root -g root -m 0644 \
  "${repo_root}/ops/strapi/systemd/aic-strapi-backup.timer" \
  /etc/systemd/system/aic-strapi-backup.timer

systemctl daemon-reload
systemctl enable aic-strapi.service aic-strapi-backup.timer >/dev/null
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
"${repo_root}/ops/strapi/sync-aic-strapi-env.sh"
systemctl start aic-strapi-backup.timer
systemctl is-active --quiet aic-strapi.service
systemctl is-active --quiet aic-strapi-backup.timer

if ss -ltnH 'sport = :1337' | awk '{print $4}' | grep -Ev '^(127\.0\.0\.1|\[::1\]):1337$' | grep -q .; then
  echo "Strapi port 1337 is listening beyond loopback." >&2
  exit 1
fi

echo "Installed and verified the private Strapi service and backup timer."
