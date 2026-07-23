#!/usr/bin/env bash
set -euo pipefail
umask 077

production_backup_root="/mnt/storage/backups/aic-strapi"
production_ops_root="/usr/local/libexec/aic-strapi"
production_config="/etc/aic/strapi-backup-replication.env"
production_recovery_confirmation="/etc/aic/strapi-backup-recovery.confirmation"
production_rclone_bin="/usr/bin/rclone"
production_lock_file="/run/lock/aic-strapi-backup-replication.lock"
remote_prefix="aic-strapi/verified-v1"

test_mode="${AIC_STRAPI_REPLICATION_TEST_MODE:-0}"
test_root="${AIC_STRAPI_REPLICATION_TEST_ROOT:-}"
case "${test_mode}" in
  0)
    backup_root="${production_backup_root}"
    ops_root="${production_ops_root}"
    replication_config="${production_config}"
    recovery_confirmation="${production_recovery_confirmation}"
    rclone_bin="${production_rclone_bin}"
    lock_file="${production_lock_file}"
    if [[ -n "${test_root}" ]]; then
      echo "Production replication rejects test path controls." >&2
      exit 1
    fi
    ;;
  1)
    if [[ "${NODE_ENV:-}" != "test" || -z "${test_root}" || ! -d "${test_root}" || -L "${test_root}" ]]; then
      echo "Replication test mode requires an isolated native test root." >&2
      exit 1
    fi
    test_root="$(readlink -m -- "${test_root}")"
    if [[ "${test_root}" != /tmp/aic-strapi-replication-test-* ]]; then
      echo "Replication test mode is restricted to its dedicated /tmp root." >&2
      exit 1
    fi
    backup_root="${AIC_STRAPI_REPLICATION_BACKUP_ROOT:-${test_root}/backups}"
    ops_root="${AIC_STRAPI_REPLICATION_OPS_ROOT:-${test_root}/ops}"
    replication_config="${AIC_STRAPI_REPLICATION_CONFIG:-${test_root}/replication.env}"
    recovery_confirmation="${AIC_STRAPI_REPLICATION_RECOVERY_CONFIRMATION:-${test_root}/recovery.confirmation}"
    rclone_bin="${AIC_STRAPI_REPLICATION_RCLONE_BIN:-${test_root}/rclone}"
    lock_file="${AIC_STRAPI_REPLICATION_LOCK_FILE:-${test_root}/replication.lock}"
    for test_path in \
      "${backup_root}" "${ops_root}" "${replication_config}" \
      "${recovery_confirmation}" "${rclone_bin}" "${lock_file}"; do
      if [[ "$(readlink -m -- "${test_path}")" != "${test_root}"/* ]]; then
        echo "Replication test paths must stay inside the dedicated test root." >&2
        exit 1
      fi
    done
    ;;
  *)
    echo "AIC_STRAPI_REPLICATION_TEST_MODE must be 0 or 1." >&2
    exit 1
    ;;
esac

if [[ "${EUID}" -ne 0 && "${test_mode}" != "1" ]]; then
  echo "Run encrypted backup replication as root." >&2
  exit 1
fi

mode="replicate"
if [[ "$#" -gt 1 ]]; then
  echo "Usage: $0 [--validate-config-only]" >&2
  exit 1
elif [[ "$#" -eq 1 ]]; then
  if [[ "$1" != "--validate-config-only" ]]; then
    echo "Usage: $0 [--validate-config-only]" >&2
    exit 1
  fi
  mode="validate"
fi

expected_owner="0:0:600"
if [[ "${test_mode}" == "1" ]]; then
  expected_owner="${EUID}:$(id -g):600"
fi

require_private_file() {
  local private_file="$1"
  local description="$2"
  if [[ -L "${private_file}" || ! -f "${private_file}" ||
        "$(stat -c '%u:%g:%a' "${private_file}" 2>/dev/null || true)" != "${expected_owner}" ]]; then
    echo "${description} must be a regular, non-symlinked ${expected_owner} file." >&2
    exit 1
  fi
}

require_private_file "${replication_config}" "The backup replication configuration"
require_private_file "${recovery_confirmation}" "The backup recovery confirmation"

declare -A settings=()
allowed_keys=(
  AIC_STRAPI_BACKUP_REPLICATION_ENABLED
  RCLONE_CONFIG_PATH
  RCLONE_CRYPT_REMOTE
  OFF_HOST_REMOTE_CONFIRMED
  REMOTE_RETENTION_GENERATIONS
)
while IFS= read -r raw_line || [[ -n "${raw_line}" ]]; do
  line="${raw_line%$'\r'}"
  [[ -z "${line}" || "${line}" == \#* ]] && continue
  if [[ ! "${line}" =~ ^([A-Z][A-Z0-9_]*)=([^[:space:]#]+)$ ]]; then
    echo "The backup replication configuration contains an invalid line." >&2
    exit 1
  fi
  key="${BASH_REMATCH[1]}"
  value="${BASH_REMATCH[2]}"
  key_allowed=0
  for allowed_key in "${allowed_keys[@]}"; do
    [[ "${key}" == "${allowed_key}" ]] && key_allowed=1
  done
  if [[ "${key_allowed}" != "1" || -n "${settings[${key}]+present}" ]]; then
    echo "The backup replication configuration contains an unknown or duplicate key." >&2
    exit 1
  fi
  settings["${key}"]="${value}"
done < "${replication_config}"

for required_key in "${allowed_keys[@]}"; do
  if [[ -z "${settings[${required_key}]:-}" ]]; then
    echo "The backup replication configuration is incomplete." >&2
    exit 1
  fi
done
if [[ "${settings[AIC_STRAPI_BACKUP_REPLICATION_ENABLED]}" != "1" ]]; then
  echo "Encrypted backup replication is disabled in its root-owned configuration." >&2
  exit 1
fi
if [[ "${settings[OFF_HOST_REMOTE_CONFIRMED]}" != "YES" ]]; then
  echo "The selected crypt backing remote has not been confirmed off-host." >&2
  exit 1
fi
if [[ ! "${settings[RCLONE_CRYPT_REMOTE]}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$ ]]; then
  echo "The rclone crypt remote name is invalid." >&2
  exit 1
fi
if [[ ! "${settings[REMOTE_RETENTION_GENERATIONS]}" =~ ^[0-9]+$ ]] ||
   (( settings[REMOTE_RETENTION_GENERATIONS] < 2 || settings[REMOTE_RETENTION_GENERATIONS] > 365 )); then
  echo "REMOTE_RETENTION_GENERATIONS must be between 2 and 365." >&2
  exit 1
fi

rclone_config="${settings[RCLONE_CONFIG_PATH]}"
if [[ "${test_mode}" == "0" ]]; then
  if [[ "${rclone_config}" != "/etc/aic/rclone-aic-strapi.conf" ]]; then
    echo "Production replication requires the dedicated AIC Strapi rclone configuration." >&2
    exit 1
  fi
elif [[ "$(readlink -m -- "${rclone_config}")" != "${test_root}"/* ]]; then
  echo "The test rclone configuration must stay inside the dedicated test root." >&2
  exit 1
fi
require_private_file "${rclone_config}" "The dedicated rclone configuration"

if [[ "$(grep -Fxc 'AIC_STRAPI_CRYPT_RECOVERY_MATERIAL_STORED_OFF_HOST=YES' "${recovery_confirmation}" || true)" != "1" ||
      "$(grep -Ec '^AIC_STRAPI_CRYPT_RECOVERY_KIT_SHA256=[0-9a-f]{64}$' "${recovery_confirmation}" || true)" != "1" ||
      "$(wc -l < "${recovery_confirmation}")" -ne 2 ]]; then
  echo "The recovery confirmation must attest an off-host kit and its SHA-256." >&2
  exit 1
fi

for required_command in "${rclone_bin}" "${ops_root}/validate-rclone-crypt-config.py"; do
  if [[ ! -x "${required_command}" || -L "${required_command}" ]]; then
    echo "Required encrypted replication command is missing or unsafe." >&2
    exit 1
  fi
done
if [[ "${mode}" == "replicate" && ( ! -x "${ops_root}/verify-strapi-backup.sh" || -L "${ops_root}/verify-strapi-backup.sh" ) ]]; then
  echo "The installed offline Strapi backup verifier is required." >&2
  exit 1
fi

run_rclone() {
  /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent "${rclone_bin}" "$@"
}

run_rclone version >/dev/null
"/usr/bin/python3" "${ops_root}/validate-rclone-crypt-config.py" \
  "${rclone_config}" "${settings[RCLONE_CRYPT_REMOTE]}" >/dev/null

if [[ "${mode}" == "validate" ]]; then
  echo "Validated disabled-by-default encrypted backup replication configuration without network or database access."
  exit 0
fi

if [[ -L "${backup_root}" || ! -d "${backup_root}" ]]; then
  echo "The exact local verified backup root is missing or unsafe." >&2
  exit 1
fi

exec 9>"${lock_file}"
if ! /usr/bin/flock --nonblock 9; then
  echo "Another encrypted Strapi backup replication is already running." >&2
  exit 1
fi

crypt_remote="${settings[RCLONE_CRYPT_REMOTE]}"
remote_base="${crypt_remote}:${remote_prefix}"
rclone_arguments=(
  --config "${rclone_config}"
  --log-level ERROR
  --stats 0
  --contimeout 15s
  --timeout 15m
  --retries 3
  --low-level-retries 10
)
runtime_root="${test_root:-/run}"
work_dir="$(mktemp -d "${runtime_root}/aic-strapi-replication.XXXXXX")"
active_staging=""

cleanup() {
  status="$?"
  trap - EXIT INT TERM
  set +e
  if [[ -n "${active_staging}" ]]; then
    run_rclone purge "${active_staging}" "${rclone_arguments[@]}" >/dev/null 2>&1
  fi
  rm -rf -- "${work_dir}"
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

expected_payload_listing="${work_dir}/expected-payload-listing"
cat > "${expected_payload_listing}" <<'EOF'
SHA256SUMS
aic-strapi-schema.contents
aic-strapi-schema.dump
manifest.env
media.contents
media.tar.gz
public-operational.contents
public-operational.dump
EOF
expected_complete_listing="${work_dir}/expected-complete-listing"
{
  printf '.complete\n'
  cat "${expected_payload_listing}"
} > "${expected_complete_listing}"

verify_local_inventory() {
  local local_backup="$1"
  local local_listing="${work_dir}/local-listing"
  find "${local_backup}" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | sort > "${local_listing}"
  if ! cmp --silent "${expected_payload_listing}" "${local_listing}" ||
     find "${local_backup}" -mindepth 1 -maxdepth 1 ! -type f -print -quit | grep -q .; then
    echo "The verified backup directory contains an unexpected file or entry." >&2
    exit 1
  fi
}

verify_remote_listing() {
  local remote_path="$1"
  local expected_listing="$2"
  local actual_listing="${work_dir}/remote-listing"
  run_rclone lsf "${remote_path}" --files-only --recursive --format p \
    "${rclone_arguments[@]}" | sort > "${actual_listing}"
  if ! cmp --silent "${expected_listing}" "${actual_listing}"; then
    echo "Encrypted remote backup listing does not match the exact approved payload." >&2
    exit 1
  fi
}

make_marker() {
  local local_backup="$1"
  local marker_path="$2"
  local checksum_sha
  checksum_sha="$(sha256sum "${local_backup}/SHA256SUMS" | awk '{print $1}')"
  {
    printf 'format_version=1\n'
    printf 'backup_stamp=%s\n' "$(basename -- "${local_backup}")"
    printf 'sha256sums_sha256=%s\n' "${checksum_sha}"
  } > "${marker_path}"
}

validate_managed_marker() {
  local remote_path="$1"
  local backup_stamp="$2"
  local marker_path="$3"
  run_rclone copyto "${remote_path}/.complete" "${marker_path}" \
    "${rclone_arguments[@]}" >/dev/null
  if [[ "$(grep -Fxc 'format_version=1' "${marker_path}" || true)" != "1" ||
        "$(grep -Fxc "backup_stamp=${backup_stamp}" "${marker_path}" || true)" != "1" ||
        "$(grep -Ec '^sha256sums_sha256=[0-9a-f]{64}$' "${marker_path}" || true)" != "1" ||
        "$(wc -l < "${marker_path}")" -ne 3 ]]; then
    echo "The encrypted backup set has an invalid managed completion marker." >&2
    exit 1
  fi
}

mapfile -t local_backups < <(
  find "${backup_root}" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??T??????Z' -print | sort
)
if [[ "${#local_backups[@]}" -eq 0 ]]; then
  echo "No completed local Strapi backup directory is available for encrypted replication." >&2
  exit 1
fi

# No network operation is attempted until every candidate has passed the
# existing offline archive/media verifier and the exact flat-file inventory.
for local_backup in "${local_backups[@]}"; do
  backup_stamp="$(basename -- "${local_backup}")"
  if [[ -L "${local_backup}" || ! "${backup_stamp}" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z$ ]]; then
    echo "Refusing an unsafe local backup directory." >&2
    exit 1
  fi
  "${ops_root}/verify-strapi-backup.sh" "${local_backup}" >/dev/null
  verify_local_inventory "${local_backup}"
done

run_rclone mkdir "${remote_base}/sets" "${rclone_arguments[@]}"
run_rclone mkdir "${remote_base}/staging" "${rclone_arguments[@]}"

sets_listing="${work_dir}/sets-listing"
run_rclone lsf "${remote_base}/sets" --dirs-only --max-depth 1 --format p \
  "${rclone_arguments[@]}" | sort > "${sets_listing}"
if grep -Ev '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z/$' "${sets_listing}" | grep -q .; then
  echo "The managed encrypted backup set prefix contains an unexpected directory." >&2
  exit 1
fi
if run_rclone lsf "${remote_base}/sets" --files-only --max-depth 1 --format p \
   "${rclone_arguments[@]}" | grep -q .; then
  echo "The managed encrypted backup set prefix contains an unexpected file." >&2
  exit 1
fi
while IFS= read -r remote_set; do
  [[ -z "${remote_set}" ]] && continue
  remote_stamp="${remote_set%/}"
  remote_set_path="${remote_base}/sets/${remote_stamp}"
  remote_marker="${work_dir}/existing-${remote_stamp}"
  validate_managed_marker "${remote_set_path}" "${remote_stamp}" "${remote_marker}"
  verify_remote_listing "${remote_set_path}" "${expected_complete_listing}"
done < "${sets_listing}"

replicated_count=0
for local_backup in "${local_backups[@]}"; do
  backup_stamp="$(basename -- "${local_backup}")"
  if [[ -L "${local_backup}" || ! "${backup_stamp}" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z$ ]]; then
    echo "Refusing an unsafe local backup directory." >&2
    exit 1
  fi
  marker="${work_dir}/marker-${backup_stamp}"
  make_marker "${local_backup}" "${marker}"
  final_remote="${remote_base}/sets/${backup_stamp}"

  if grep -Fqx "${backup_stamp}/" "${sets_listing}"; then
    downloaded_marker="${work_dir}/downloaded-${backup_stamp}"
    if ! run_rclone copyto "${final_remote}/.complete" "${downloaded_marker}" \
      "${rclone_arguments[@]}" >/dev/null; then
      echo "An existing encrypted backup set is incomplete; refusing to overwrite it." >&2
      exit 1
    fi
    if ! cmp --silent "${marker}" "${downloaded_marker}"; then
      echo "An existing encrypted backup completion marker does not match local evidence." >&2
      exit 1
    fi
    verify_remote_listing "${final_remote}" "${expected_complete_listing}"
    continue
  fi

  staging_id="$(tr -d '\n' < /proc/sys/kernel/random/uuid)"
  if [[ ! "${staging_id}" =~ ^[0-9a-f-]{36}$ ]]; then
    echo "Could not create a safe replication staging identifier." >&2
    exit 1
  fi
  active_staging="${remote_base}/staging/${backup_stamp}-${staging_id}"
  run_rclone copy "${local_backup}" "${active_staging}" "${rclone_arguments[@]}"
  verify_remote_listing "${active_staging}" "${expected_payload_listing}"
  run_rclone cryptcheck "${local_backup}" "${active_staging}" "${rclone_arguments[@]}"

  run_rclone moveto "${active_staging}" "${final_remote}" "${rclone_arguments[@]}"
  active_staging=""
  verify_remote_listing "${final_remote}" "${expected_payload_listing}"
  run_rclone cryptcheck "${local_backup}" "${final_remote}" "${rclone_arguments[@]}"
  run_rclone copyto "${marker}" "${final_remote}/.complete" "${rclone_arguments[@]}"
  downloaded_marker="${work_dir}/downloaded-${backup_stamp}"
  run_rclone copyto "${final_remote}/.complete" "${downloaded_marker}" \
    "${rclone_arguments[@]}" >/dev/null
  cmp --silent "${marker}" "${downloaded_marker}"
  verify_remote_listing "${final_remote}" "${expected_complete_listing}"
  printf '%s/\n' "${backup_stamp}" >> "${sets_listing}"
  sort -o "${sets_listing}" "${sets_listing}"
  replicated_count=$((replicated_count + 1))
done

mapfile -t remote_sets < "${sets_listing}"
retention="${settings[REMOTE_RETENTION_GENERATIONS]}"
remove_count=$((${#remote_sets[@]} - retention))
if (( remove_count > 0 )); then
  for ((index = 0; index < remove_count; index += 1)); do
    old_stamp="${remote_sets[index]%/}"
    old_remote="${remote_base}/sets/${old_stamp}"
    old_marker="${work_dir}/retention-${old_stamp}"
    validate_managed_marker "${old_remote}" "${old_stamp}" "${old_marker}"
    run_rclone purge "${old_remote}" "${rclone_arguments[@]}"
  done
fi

echo "Encrypted off-host replication completed; new verified generations: ${replicated_count}."
