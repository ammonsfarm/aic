#!/usr/bin/env bash
set -euo pipefail

START_TIMERS="${START_TIMERS:-0}"
case "${START_TIMERS}" in 0|1) ;; *) echo "START_TIMERS must be 0 or 1." >&2; exit 1 ;; esac
ENABLE_TIMERS="${ENABLE_TIMERS:-0}"
case "${ENABLE_TIMERS}" in 0|1) ;; *) echo "ENABLE_TIMERS must be 0 or 1." >&2; exit 1 ;; esac
if [[ "${START_TIMERS}" == "1" && "${ENABLE_TIMERS}" != "1" ]]; then
  echo "START_TIMERS=1 requires ENABLE_TIMERS=1." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${script_dir}/.." && pwd)"
if [[ "${repo_dir}" != "/mnt/storage/aic" ]]; then
  echo "Scheduled podcast units must be installed from /mnt/storage/aic." >&2
  exit 1
fi
timers=(
  aic-podcast-daily-ingest.timer
  aic-podtrac-daily-ingest.timer
)
services=(
  aic-podcast-daily-ingest.service
  aic-podtrac-daily-ingest.service
)

for unit in "${services[@]}" "${timers[@]}"; do
  sudo install -o root -g root -m 0644 "${repo_dir}/systemd/${unit}" "/etc/systemd/system/${unit}"
done
sudo systemctl daemon-reload
if [[ "${ENABLE_TIMERS}" == "1" ]]; then
  sudo systemctl enable "${timers[@]}"
fi
if [[ "${START_TIMERS}" == "1" ]]; then
  sudo systemctl start "${timers[@]}"
fi
sudo systemctl list-timers --all "${timers[@]}" --no-pager
