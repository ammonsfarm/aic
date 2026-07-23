#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-aic-transcript-edit-worker.service}"
TIMER_NAME="${TIMER_NAME:-aic-transcript-edit-worker.timer}"
START_TIMER="${START_TIMER:-0}"

case "${START_TIMER}" in 0|1) ;; *) echo "START_TIMER must be 0 or 1." >&2; exit 1 ;; esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${script_dir}/.." && pwd)"

sudo install -m 0644 "${repo_dir}/systemd/${SERVICE_NAME}" "/etc/systemd/system/${SERVICE_NAME}"
sudo install -m 0644 "${repo_dir}/systemd/${TIMER_NAME}" "/etc/systemd/system/${TIMER_NAME}"
sudo systemctl daemon-reload
sudo systemctl enable "${TIMER_NAME}"
if [[ "${START_TIMER}" == "1" ]]; then
  sudo systemctl start "${TIMER_NAME}"
fi
sudo systemctl list-timers --all "${TIMER_NAME}" --no-pager
