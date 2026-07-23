#!/usr/bin/env bash
set -euo pipefail

daily_line='15 4 * * * cd /mnt/storage/aic_podcast && /mnt/storage/aic_podcast/.venv-pg/bin/python -u run_daily_podcast_ingest.py --transcribe-engine mistral --max-tracks 50 --transcribe-workers 4 --intelligence-workers 4 --intelligence-provider silo --intelligence-model openai-codex/gpt-5.6-luna --intelligence-reasoning-effort medium --no-extractive-fallback >> /mnt/storage/aic_podcast/run_logs/cron_daily_ingest.log 2>&1'
podtrac_line='15 4 * * * /usr/bin/flock -n /tmp/aic_podtrac_ingest.lock /mnt/storage/aic_podcast/scripts/run_podtrac_daily_server.sh >> /mnt/storage/aic_podcast/run_logs/cron_podtrac_daily.log 2>&1'
test_mode="${AIC_CRON_MIGRATION_TEST_MODE:-0}"
case "${test_mode}" in 0|1) ;; *) echo "AIC_CRON_MIGRATION_TEST_MODE must be 0 or 1." >&2; exit 1 ;; esac
script_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
if [[ "${test_mode}" == "0" && "${script_path}" != "/mnt/storage/aic/scripts/migrate-legacy-podcast-cron.sh" ]]; then
  echo "Legacy cron migration must run from /mnt/storage/aic." >&2
  exit 1
fi

temporary_current="$(mktemp /tmp/aic-podcast-cron-current.XXXXXX)"
temporary_updated="$(mktemp /tmp/aic-podcast-cron-updated.XXXXXX)"
cleanup() {
  rm -f -- "${temporary_current}" "${temporary_updated}"
}
trap cleanup EXIT INT TERM
chmod 0600 "${temporary_current}" "${temporary_updated}"

if [[ "${test_mode}" == "1" ]]; then
  test_file="${AIC_CRON_TEST_FILE:-}"
  if [[ "${NODE_ENV:-}" != "test" || ! "${test_file}" =~ ^/tmp/aic-podcast-cron-test-[A-Za-z0-9._-]+$ || ! -f "${test_file}" || -L "${test_file}" ]]; then
    echo "Cron migration test mode requires NODE_ENV=test and an isolated /tmp/aic-podcast-cron-test-* file." >&2
    exit 1
  fi
  cp -- "${test_file}" "${temporary_current}"
else
  if [[ -n "${AIC_CRON_TEST_FILE:-}" ]]; then
    echo "AIC_CRON_TEST_FILE is forbidden outside isolated test mode." >&2
    exit 1
  fi
  for timer in aic-podcast-daily-ingest.timer aic-podtrac-daily-ingest.timer; do
    if ! /usr/bin/systemctl is-active --quiet "${timer}"; then
      echo "Replacement timer is not active; refusing to remove legacy cron: ${timer}" >&2
      exit 1
    fi
  done
  if ! /usr/bin/crontab -l >"${temporary_current}" 2>/dev/null; then
    : >"${temporary_current}"
  fi
fi

daily_matches="$(grep -Fxc -- "${daily_line}" "${temporary_current}" || true)"
podtrac_matches="$(grep -Fxc -- "${podtrac_line}" "${temporary_current}" || true)"
if [[ "${daily_matches}" == "0" && "${podtrac_matches}" == "0" ]]; then
  echo "Legacy AIC podcast cron entries already absent; no crontab change needed."
  exit 0
fi

removed=0
while IFS= read -r line || [[ -n "${line}" ]]; do
  if [[ "${line}" == "${daily_line}" || "${line}" == "${podtrac_line}" ]]; then
    removed=$((removed + 1))
    continue
  fi
  printf '%s\n' "${line}" >>"${temporary_updated}"
done <"${temporary_current}"

if [[ "${test_mode}" == "1" ]]; then
  install -m 0600 "${temporary_updated}" "${test_file}"
else
  /usr/bin/crontab "${temporary_updated}"
  verification="$(mktemp /tmp/aic-podcast-cron-verify.XXXXXX)"
  chmod 0600 "${verification}"
  /usr/bin/crontab -l >"${verification}"
  if grep -Fqx -- "${daily_line}" "${verification}" || grep -Fqx -- "${podtrac_line}" "${verification}"; then
    /usr/bin/crontab "${temporary_current}" || true
    rm -f -- "${verification}"
    echo "Legacy cron verification failed after installation; the original crontab was restored." >&2
    exit 1
  fi
  rm -f -- "${verification}"
fi

echo "Removed ${removed} exact legacy AIC podcast cron entr$( [[ "${removed}" == "1" ]] && printf 'y' || printf 'ies' ); unrelated entries were preserved."
