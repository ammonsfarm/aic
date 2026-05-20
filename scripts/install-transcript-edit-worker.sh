#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-aic-transcript-edit-worker.service}"
TIMER_NAME="${TIMER_NAME:-aic-transcript-edit-worker.timer}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "${script_dir}/.." && pwd)"

sudo install -m 0644 "${repo_dir}/systemd/${SERVICE_NAME}" "/etc/systemd/system/${SERVICE_NAME}"
sudo install -m 0644 "${repo_dir}/systemd/${TIMER_NAME}" "/etc/systemd/system/${TIMER_NAME}"
sudo systemctl daemon-reload
sudo systemctl enable --now "${TIMER_NAME}"
sudo systemctl list-timers --all "${TIMER_NAME}" --no-pager
