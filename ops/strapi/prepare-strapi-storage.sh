#!/usr/bin/env bash
set -euo pipefail

cms_root="${STRAPI_CMS_ROOT:-/mnt/storage/aic/services/jimwood-cms}"
media_root="${STRAPI_MEDIA_ROOT:-/mnt/storage/pastorwood-media/strapi/uploads}"
uploads_path="${cms_root}/public/uploads"

case "${media_root}" in
  /mnt/storage/pastorwood-media/strapi/*) ;;
  *)
    echo "Refusing unexpected Strapi media root: ${media_root}" >&2
    exit 1
    ;;
esac

install -d -m 0750 "${media_root}"
install -d -m 0755 "${cms_root}/public"

if [[ -L "${uploads_path}" ]]; then
  current_target="$(readlink "${uploads_path}")"
  if [[ "${current_target}" != "${media_root}" ]]; then
    echo "Existing uploads symlink points to ${current_target}, expected ${media_root}." >&2
    exit 1
  fi
  exit 0
fi

if [[ -e "${uploads_path}" ]]; then
  if [[ ! -d "${uploads_path}" ]] || find "${uploads_path}" -mindepth 1 -print -quit | grep -q .; then
    echo "Refusing to replace non-empty uploads path: ${uploads_path}" >&2
    exit 1
  fi
  rmdir -- "${uploads_path}"
fi

ln -s "${media_root}" "${uploads_path}"
