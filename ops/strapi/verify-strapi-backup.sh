#!/usr/bin/env bash
set -euo pipefail
umask 077

backup_root="${STRAPI_BACKUP_ROOT:-/mnt/storage/backups/aic-strapi}"
docker_bin="${STRAPI_BACKUP_DOCKER_BIN:-/usr/bin/docker}"
postgres_client_image="${STRAPI_BACKUP_POSTGRES_IMAGE:-postgres:16}"

case "${backup_root}" in
  /mnt/storage/backups/*) ;;
  *)
    echo "Refusing unexpected backup root: ${backup_root}" >&2
    exit 1
    ;;
esac

if [[ "$#" -gt 1 ]]; then
  echo "Usage: $0 [backup-directory]" >&2
  exit 1
fi

backup_dir="${1:-}"
if [[ -z "${backup_dir}" ]]; then
  backup_dir="$(find "${backup_root}" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??T??????Z' -print | sort | tail -n 1)"
fi
case "${backup_dir}" in
  "${backup_root}"/20??-??-??T??????Z) ;;
  *)
    echo "Refusing unexpected or missing Strapi backup directory: ${backup_dir:-none}" >&2
    exit 1
    ;;
esac

for required in database.dump database.contents media.tar.gz media.contents manifest.env SHA256SUMS; do
  if [[ ! -f "${backup_dir}/${required}" ]]; then
    echo "Incomplete Strapi backup: missing ${required}." >&2
    exit 1
  fi
done
if ! grep -Fxq 'database_schema=aic_strapi' "${backup_dir}/manifest.env"; then
  echo "Backup manifest is not scoped to the aic_strapi schema." >&2
  exit 1
fi
if ! grep -Fxq 'database_host=192.168.1.106' "${backup_dir}/manifest.env" ||
   ! grep -Fxq 'database_port=5432' "${backup_dir}/manifest.env"; then
  echo "Backup manifest does not identify the existing AIC PostgreSQL target." >&2
  exit 1
fi

(
  cd "${backup_dir}"
  sha256sum --check SHA256SUMS
)

if [[ ! -x "${docker_bin}" ]]; then
  echo "Docker is required at ${docker_bin}." >&2
  exit 1
fi
if ! "${docker_bin}" image inspect "${postgres_client_image}" >/dev/null 2>&1; then
  echo "Required local PostgreSQL client image is missing: ${postgres_client_image}" >&2
  exit 1
fi

temporary_dir="$(mktemp -d /tmp/aic-strapi-backup-verify.XXXXXX)"
cleanup() {
  rm -rf -- "${temporary_dir}"
}
trap cleanup EXIT

docker_safety=(
  --rm
  --pull=never
  --read-only
  --cap-drop ALL
  --security-opt no-new-privileges
  --user "$(id -u):$(id -g)"
)

"${docker_bin}" run \
  "${docker_safety[@]}" \
  --network none \
  --mount "type=bind,src=${backup_dir},dst=/backup,readonly" \
  "${postgres_client_image}" \
  pg_restore --list /backup/database.dump > "${temporary_dir}/database.contents"

"${docker_bin}" run \
  "${docker_safety[@]}" \
  --network none \
  --mount "type=bind,src=${backup_dir},dst=/backup,readonly" \
  "${postgres_client_image}" \
  pg_restore --exit-on-error --file=/dev/null /backup/database.dump

cmp --silent "${backup_dir}/database.contents" "${temporary_dir}/database.contents"
grep -Fq 'SCHEMA - aic_strapi' "${temporary_dir}/database.contents"

tar --list --gzip --file "${backup_dir}/media.tar.gz" > "${temporary_dir}/media.contents"
cmp --silent "${backup_dir}/media.contents" "${temporary_dir}/media.contents"

echo "Verified Strapi backup archives, listings, and checksums without restoring a database: ${backup_dir}"
