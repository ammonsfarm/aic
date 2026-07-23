#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this operations installer as root." >&2
  exit 1
fi

source_root="${STRAPI_OPS_SOURCE_ROOT:-/mnt/storage/aic/ops/strapi}"
libexec_root="${STRAPI_OPS_ROOT:-/usr/local/libexec/aic-strapi}"

if [[ "${source_root}" != "/mnt/storage/aic/ops/strapi" ||
      "${libexec_root}" != "/usr/local/libexec/aic-strapi" ]]; then
  echo "Refusing unexpected Strapi operations source or destination." >&2
  exit 1
fi

scripts=(
  backup-strapi.sh
  ensure-strapi-schema.sh
  install-strapi-service.sh
  prepare-strapi-storage.sh
  provision-strapi.sh
  require-canonical-db-context.sh
  run-consistent-backup.sh
  sync-aic-strapi-env.sh
  verify-strapi-backup.sh
  with-aic-db-env.sh
)
units=(
  aic-strapi.service
  aic-strapi-schema.service
  aic-strapi-backup.service
  aic-strapi-backup.timer
)

install -d -o root -g root -m 0755 "${libexec_root}" "${libexec_root}/systemd"
for script in "${scripts[@]}"; do
  install -o root -g root -m 0755 "${source_root}/${script}" "${libexec_root}/${script}"
done
for unit in "${units[@]}"; do
  install -o root -g root -m 0644 "${source_root}/systemd/${unit}" "${libexec_root}/systemd/${unit}"
done

echo "Installed root-owned Strapi operations under ${libexec_root}."
