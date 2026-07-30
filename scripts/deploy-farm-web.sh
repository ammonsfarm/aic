#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-farm}"
REMOTE_USER="${REMOTE_USER:-ammonsfarm}"
REMOTE_DIR="${REMOTE_DIR:-/mnt/storage/aic}"
REMOTE_BRANCH="${REMOTE_BRANCH:-main}"
REMOTE_SERVICE="${REMOTE_SERVICE:-aic-web.service}"
REMOTE_PORT="${REMOTE_PORT:-8087}"
INSTALL_TRANSCRIPT_EDIT_WORKER="${INSTALL_TRANSCRIPT_EDIT_WORKER:-1}"
INSTALL_STRAPI_SERVICE="${INSTALL_STRAPI_SERVICE:-1}"
RUN_STRAPI_BACKUP_VERIFY="${RUN_STRAPI_BACKUP_VERIFY:-1}"
INSTALL_ADMIN_OPERATIONS_WORKER="${INSTALL_ADMIN_OPERATIONS_WORKER:-1}"
INSTALL_EPISODE_PUBLISH_WORKER="${INSTALL_EPISODE_PUBLISH_WORKER:-1}"
INSTALL_SUBSCRIPTION_PROVIDER_WORKER="${INSTALL_SUBSCRIPTION_PROVIDER_WORKER:-1}"
INSTALL_CONTACT_EMAIL_WORKER="${INSTALL_CONTACT_EMAIL_WORKER:-1}"
INSTALL_SCHEDULED_PUBLICATION_WORKER="${INSTALL_SCHEDULED_PUBLICATION_WORKER:-1}"
INSTALL_PUBLIC_DATA_RETENTION_WORKER="${INSTALL_PUBLIC_DATA_RETENTION_WORKER:-1}"
CONFIGURE_PASTORWOOD_DEVELOPMENT_ENV="${CONFIGURE_PASTORWOOD_DEVELOPMENT_ENV:-0}"
INSTALL_PODCAST_SCHEDULED_WORKERS="${INSTALL_PODCAST_SCHEDULED_WORKERS:-1}"
SERVICE_URL="http://127.0.0.1:${REMOTE_PORT}"

for toggle in \
  "${INSTALL_TRANSCRIPT_EDIT_WORKER}" \
  "${INSTALL_STRAPI_SERVICE}" \
  "${RUN_STRAPI_BACKUP_VERIFY}" \
  "${INSTALL_ADMIN_OPERATIONS_WORKER}" \
  "${INSTALL_EPISODE_PUBLISH_WORKER}" \
  "${INSTALL_SUBSCRIPTION_PROVIDER_WORKER}" \
  "${INSTALL_CONTACT_EMAIL_WORKER}" \
  "${INSTALL_SCHEDULED_PUBLICATION_WORKER}" \
  "${INSTALL_PUBLIC_DATA_RETENTION_WORKER}" \
  "${CONFIGURE_PASTORWOOD_DEVELOPMENT_ENV}" \
  "${INSTALL_PODCAST_SCHEDULED_WORKERS}"; do
  case "${toggle}" in 0|1) ;; *) echo "Deployment toggles must be 0 or 1." >&2; exit 1 ;; esac
done
ssh_target="${REMOTE_USER}@${REMOTE_HOST}"

cat <<EOF
Deploying AIC web app to $ssh_target
  directory: $REMOTE_DIR
  branch:    $REMOTE_BRANCH
  service:   $REMOTE_SERVICE
  port:      $REMOTE_PORT
EOF

ssh "${ssh_target}" <<SSH
set -euo pipefail

# The checked-in .env is authoritative. Prevent an SSH/session environment from
# overriding the exact database target later loaded by migration and build tools.
unset DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD
unset PGPASSFILE PGSERVICE PGSERVICEFILE PGOPTIONS
unset CONTACT_EMAIL_DELIVERY_ENABLED CONTACT_EMAIL_SMTP_HOST CONTACT_EMAIL_SMTP_PORT
unset CONTACT_EMAIL_SMTP_USERNAME CONTACT_EMAIL_SMTP_PASSWORD CONTACT_EMAIL_SMTP_STARTTLS
unset CONTACT_EMAIL_FROM CONTACT_EMAIL_TO
unset STRAPI_URL STRAPI_MANAGEMENT_URL STRAPI_PUBLIC_URL STRAPI_API_TOKEN
unset STRAPI_READ_TOKEN STRAPI_MANAGEMENT_TOKEN STRAPI_API_TOKEN_TEMP_WRITE

echo "Checking native PostgreSQL 16 clients without changing the database..."
for client in psql pg_dump pg_restore; do
  test -x "/usr/lib/postgresql/16/bin/\${client}"
  "/usr/lib/postgresql/16/bin/\${client}" --version | grep -Eq "^\${client} \(PostgreSQL\) 16\."
done

echo "Running an exact-target, read-only database preflight before changing the checkout..."
cd "${REMOTE_DIR}"
test -x ops/strapi/with-aic-db-env.sh
preflight_result="\$(
  NODE_ENV=production ops/strapi/with-aic-db-env.sh \
    /usr/bin/bash -c 'exec /usr/bin/env \
      PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000" \
      /usr/lib/postgresql/16/bin/psql \
      --host "\${DATABASE_HOST}" --port "\${DATABASE_PORT}" \
      --dbname "\${DATABASE_NAME}" --username "\${DATABASE_USERNAME}" \
      --no-password --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --no-align \
      --command "select 1"'
)"
if [[ "\${preflight_result}" != "1" ]]; then
  echo "Existing AIC PostgreSQL preflight returned an unexpected result; aborting before checkout mutation." >&2
  exit 1
fi

wait_for_strapi_health() {
  for _attempt in \$(seq 1 30); do
    if curl -fsS http://127.0.0.1:1337/_health >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

wait_for_web_health() {
  for _attempt in \$(seq 1 15); do
    if curl -fsS "${SERVICE_URL}/" >/dev/null &&
       curl -fsS "${SERVICE_URL}/login" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

if [ "${INSTALL_STRAPI_SERVICE}" = "0" ] && \
   { [ "${INSTALL_SCHEDULED_PUBLICATION_WORKER}" = "1" ] || [ "${INSTALL_EPISODE_PUBLISH_WORKER}" = "1" ]; }; then
  echo "Pre-checking the existing private Strapi required by enabled workers..."
  sudo systemctl is-active --quiet aic-strapi.service
  wait_for_strapi_health
fi

echo "Acquiring podcast and Podtrac scheduler locks before checkout or migration mutation..."
exec 8>>/mnt/storage/aic_podcast/daily_ingest.lock
if ! /usr/bin/flock -n 8; then
  echo "The canonical podcast ingest lock is active; aborting before checkout mutation." >&2
  exit 1
fi
exec 9>>/tmp/aic_podtrac_ingest.lock
if ! /usr/bin/flock -n 9; then
  echo "The canonical Podtrac ingest lock is active; aborting before checkout mutation." >&2
  exit 1
fi

previous_sha="\$(git rev-parse HEAD)"
if [[ -n "\$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Deployment checkout has tracked changes; refusing to mutate or overwrite them." >&2
  exit 1
fi

all_timers=(
  aic-transcript-edit-worker.timer
  aic-admin-operations-worker.timer
  aic-episode-publish-worker.timer
  aic-subscription-provider-worker.timer
  aic-contact-email-worker.timer
  aic-scheduled-publication-worker.timer
  aic-public-data-retention-worker.timer
  aic-podcast-daily-ingest.timer
  aic-podtrac-daily-ingest.timer
  aic-strapi-backup.timer
  aic-strapi-backup-replication.timer
)
all_worker_services=(
  aic-transcript-edit-worker.service
  aic-admin-operations-worker.service
  aic-episode-publish-worker.service
  aic-subscription-provider-worker.service
  aic-contact-email-worker.service
  aic-scheduled-publication-worker.service
  aic-public-data-retention-worker.service
  aic-podcast-daily-ingest.service
  aic-podtrac-daily-ingest.service
  aic-strapi-backup-replication.service
)
previous_active_timers=()
for timer in "\${all_timers[@]}"; do
  if sudo systemctl is-active --quiet "\${timer}"; then
    previous_active_timers+=("\${timer}")
  fi
done
web_was_active=0
strapi_was_active=0
sudo systemctl is-active --quiet "${REMOTE_SERVICE}" && web_was_active=1 || true
sudo systemctl is-active --quiet aic-strapi.service && strapi_was_active=1 || true
checkout_changed=0
migrations_started=0
ops_install_started=0

stop_release_runtime() {
  for unit in "\${all_timers[@]}" "\${all_worker_services[@]}" aic-strapi-backup.service; do
    sudo systemctl stop "\${unit}" >/dev/null 2>&1 || true
  done
  sudo systemctl stop "${REMOTE_SERVICE}" >/dev/null 2>&1 || true
  sudo systemctl stop aic-strapi.service >/dev/null 2>&1 || true
}

restore_predeployment_runtime() {
  local service_action=start
  if [[ "\${checkout_changed}" == "1" ]]; then
    service_action=restart
  fi

  if [[ "\${strapi_was_active}" == "1" ]]; then
    sudo systemctl "\${service_action}" aic-strapi.service || return 1
    wait_for_strapi_health || return 1
  else
    sudo systemctl stop aic-strapi.service >/dev/null 2>&1 || true
    if sudo systemctl is-active --quiet aic-strapi.service; then
      return 1
    fi
  fi

  if [[ "\${web_was_active}" == "1" ]]; then
    sudo systemctl "\${service_action}" "${REMOTE_SERVICE}" || return 1
    wait_for_web_health || return 1
  else
    sudo systemctl stop "${REMOTE_SERVICE}" >/dev/null 2>&1 || true
    if sudo systemctl is-active --quiet "${REMOTE_SERVICE}"; then
      return 1
    fi
  fi

  if [[ "\${#previous_active_timers[@]}" -gt 0 ]]; then
    sudo systemctl start "\${previous_active_timers[@]}" || return 1
    for timer in "\${previous_active_timers[@]}"; do
      sudo systemctl is-active --quiet "\${timer}" || return 1
    done
  fi
  return 0
}

deployment_failed() {
  status="\$1"
  trap - EXIT INT TERM
  set +e
  echo "Deployment failed with status \${status}." >&2
  for unit in "\${all_timers[@]}" "\${all_worker_services[@]}" aic-strapi-backup.service; do
    sudo systemctl stop "\${unit}" >/dev/null 2>&1 || true
  done

  if [[ "\${migrations_started}" == "0" ]]; then
    rollback_ok=1
    if [[ "\${checkout_changed}" == "1" ]]; then
      echo "No migration command started; attempting a bounded application rollback to \${previous_sha}." >&2
      sudo systemctl stop "${REMOTE_SERVICE}" >/dev/null 2>&1 || true
      sudo systemctl stop aic-strapi.service >/dev/null 2>&1 || true
      git checkout --detach "\${previous_sha}" || rollback_ok=0
      if [[ "\${rollback_ok}" == "1" ]]; then
        npm ci || rollback_ok=0
        npm --prefix services/jimwood-cms ci || rollback_ok=0
        .venv-pg/bin/python -m pip install -r requirements-postgres.txt || rollback_ok=0
        NODE_ENV=production ops/strapi/with-aic-db-env.sh npm --prefix services/jimwood-cms run build || rollback_ok=0
        npm run build || rollback_ok=0
      fi
    fi

    if [[ "\${rollback_ok}" == "1" && "\${ops_install_started}" == "1" ]]; then
      sudo install -o root -g root -m 0755 \
        ops/strapi/install-strapi-ops.sh \
        /usr/local/sbin/aic-install-strapi-ops || rollback_ok=0
      if [[ "\${rollback_ok}" == "1" ]]; then
        sudo /usr/local/sbin/aic-install-strapi-ops || rollback_ok=0
      fi
    fi

    if [[ "\${rollback_ok}" == "1" ]]; then
      restore_predeployment_runtime || rollback_ok=0
    fi
    if [[ "\${rollback_ok}" == "1" ]]; then
      echo "Pre-deployment application, service, and active-timer state was restored." >&2
      if [[ "\${checkout_changed}" == "1" ]]; then
        echo "The checkout is intentionally detached at \${previous_sha}." >&2
      fi
      exit "\${status}"
    fi
    echo "Automatic pre-migration rollback was incomplete." >&2
  else
    echo "The forward-only migration phase started; no database or code rollback was attempted." >&2
    sudo systemctl disable --now aic-contact-email-worker.timer >/dev/null 2>&1 || true
  fi

  stop_release_runtime
  echo "Release runtime is fail-closed: web, Strapi, workers, and timers were stopped." >&2
  echo "Timers active before deployment: \${previous_active_timers[*]:-none}. Repair the release and verify both services before restarting them." >&2
  exit "\${status}"
}
trap 'deployment_failed \$?' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Quiescing worker and backup timers before changing the checkout..."
for unit in "\${all_timers[@]}" "\${all_worker_services[@]}" aic-strapi-backup.service; do
  sudo systemctl stop "\${unit}" >/dev/null 2>&1 || true
done
for unit in "\${all_timers[@]}" "\${all_worker_services[@]}" aic-strapi-backup.service; do
  if sudo systemctl is-active --quiet "\${unit}"; then
    echo "Could not quiesce \${unit}; aborting before checkout mutation." >&2
    exit 1
  fi
done

echo "Stopping web and private Strapi before mutating release files..."
for service in "${REMOTE_SERVICE}" aic-strapi.service; do
  sudo systemctl stop "\${service}" >/dev/null 2>&1 || true
done
for service in "${REMOTE_SERVICE}" aic-strapi.service; do
  if sudo systemctl is-active --quiet "\${service}"; then
    echo "Could not stop \${service}; aborting before checkout mutation." >&2
    exit 1
  fi
done

echo "Updating code..."
echo "Previous application revision: \${previous_sha}"
checkout_changed=1
git fetch --all
git checkout "${REMOTE_BRANCH}"
git pull --ff-only origin "${REMOTE_BRANCH}"

if [ "${CONFIGURE_PASTORWOOD_DEVELOPMENT_ENV}" = "1" ]; then
  echo "Pinning the five PastorWood development launch gates in the canonical environment..."
  sudo install -o root -g root -m 0755 \
    scripts/configure-pastorwood-development-env.py \
    /usr/local/sbin/aic-configure-pastorwood-development-env
  sudo /usr/bin/env \
    -u NODE_ENV \
    -u PASTORWOOD_DEVELOPMENT_ENV_TEST_MODE \
    -u PASTORWOOD_DEVELOPMENT_ENV_TEST_ROOT \
    -u PASTORWOOD_DEVELOPMENT_ENV_TEST_ENV_FILE \
    -u PASTORWOOD_DEVELOPMENT_ENV_TEST_LOCK_FILE \
    -u PASTORWOOD_DEVELOPMENT_ENV_TEST_READY_FILE \
    -u PASTORWOOD_DEVELOPMENT_ENV_TEST_RELEASE_FILE \
    /usr/local/sbin/aic-configure-pastorwood-development-env CONFIGURE_PASTORWOOD_DEVELOPMENT
fi

echo "Installing dependencies..."
npm ci
npm --prefix services/jimwood-cms ci

echo "Preparing the canonical Python worker runtime..."
if [[ ! -x .venv-pg/bin/python ]]; then
  python3 -m venv .venv-pg
fi
.venv-pg/bin/python -m pip install -r requirements-postgres.txt

echo "Running release tests and builds before database or service mutation..."
NODE_ENV=production node scripts/check-pastorwood-launch-config.mjs \
  --env-file /mnt/storage/aic/.env \
  --subscription-worker-enabled "${INSTALL_SUBSCRIPTION_PROVIDER_WORKER}" \
  --contact-email-worker-enabled "${INSTALL_CONTACT_EMAIL_WORKER}"
npm test
npm --prefix services/jimwood-cms test
npm run lint
NODE_ENV=production ops/strapi/with-aic-db-env.sh npm --prefix services/jimwood-cms run build
npm run build

subscription_provider_ready=0
if .venv-pg/bin/python scripts/process_subscription_provider_outbox.py \
  --env-file /mnt/storage/aic/.env --check-config; then
  subscription_provider_ready=1
fi
contact_email_ready=0
if .venv-pg/bin/python scripts/process_contact_email_outbox.py \
  --env-file /mnt/storage/aic/.env --check-config; then
  contact_email_ready=1
fi
echo "Installing root-owned Strapi operations..."
ops_install_started=1
sudo install -o root -g root -m 0755 \
  ops/strapi/install-strapi-ops.sh \
  /usr/local/sbin/aic-install-strapi-ops
sudo /usr/local/sbin/aic-install-strapi-ops

echo "Validating the existing AIC PostgreSQL target..."
/usr/local/libexec/aic-strapi/with-aic-db-env.sh /usr/bin/true

echo "Applying database migrations..."
migrations_started=1
.venv-pg/bin/python apply_postgres_migrations.py --env-file /mnt/storage/aic/.env

if [ "${INSTALL_STRAPI_SERVICE}" = "1" ]; then
  echo "Provisioning and installing private Strapi service..."
  sudo /usr/local/libexec/aic-strapi/provision-strapi.sh
  sudo /usr/local/libexec/aic-strapi/install-strapi-service.sh
  echo "Ensuring the first audited site-settings draft exists..."
  unset STRAPI_URL STRAPI_MANAGEMENT_URL STRAPI_PUBLIC_URL STRAPI_API_TOKEN
  unset STRAPI_READ_TOKEN STRAPI_MANAGEMENT_TOKEN STRAPI_API_TOKEN_TEMP_WRITE
  NODE_ENV=production node scripts/seed-strapi-site-settings.mjs
fi

timers_to_start=()

if [ "${INSTALL_TRANSCRIPT_EDIT_WORKER}" = "1" ]; then
  echo "Installing transcript edit worker timer..."
  START_TIMER=0 bash scripts/install-transcript-edit-worker.sh
  timers_to_start+=(aic-transcript-edit-worker.timer)
else
  sudo systemctl disable aic-transcript-edit-worker.timer >/dev/null 2>&1 || true
fi

if [ "${INSTALL_ADMIN_OPERATIONS_WORKER}" = "1" ]; then
  echo "Installing allowlisted admin operations worker timer..."
  START_TIMER=0 bash scripts/install-admin-operations-worker.sh
  timers_to_start+=(aic-admin-operations-worker.timer)
else
  sudo systemctl disable aic-admin-operations-worker.timer >/dev/null 2>&1 || true
fi

if [ "${INSTALL_EPISODE_PUBLISH_WORKER}" = "1" ]; then
  echo "Installing Strapi episode publication worker timer..."
  START_TIMER=0 bash scripts/install-episode-publish-worker.sh
  timers_to_start+=(aic-episode-publish-worker.timer)
else
  sudo systemctl disable aic-episode-publish-worker.timer >/dev/null 2>&1 || true
fi

if [ "${INSTALL_SUBSCRIPTION_PROVIDER_WORKER}" = "1" ] && [[ "\${subscription_provider_ready}" == "1" ]]; then
  echo "Installing Mailchimp subscription provider worker timer..."
  START_TIMER=0 bash scripts/install-subscription-provider-worker.sh
  timers_to_start+=(aic-subscription-provider-worker.timer)
else
  echo "Subscription provider is incomplete; keeping its timer disabled and the public signup disabled."
  sudo systemctl disable --now aic-subscription-provider-worker.timer >/dev/null 2>&1 || true
fi

if [ "${INSTALL_CONTACT_EMAIL_WORKER}" = "1" ] && [[ "\${contact_email_ready}" == "1" ]]; then
  echo "Installing public contact SMTP notification worker timer..."
  ENABLE_TIMER=0 START_TIMER=0 bash scripts/install-contact-email-worker.sh
else
  echo "Contact email delivery is disabled or incomplete; keeping its timer disabled."
  sudo systemctl disable --now aic-contact-email-worker.timer >/dev/null 2>&1 || true
fi

if [ "${INSTALL_SCHEDULED_PUBLICATION_WORKER}" = "1" ]; then
  echo "Installing scheduled Strapi publication worker timer..."
  START_TIMER=0 bash scripts/install-scheduled-publication-worker.sh
  timers_to_start+=(aic-scheduled-publication-worker.timer)
else
  sudo systemctl disable aic-scheduled-publication-worker.timer >/dev/null 2>&1 || true
fi

if [ "${INSTALL_PUBLIC_DATA_RETENTION_WORKER}" = "1" ]; then
  echo "Installing public-data retention worker timer..."
  START_TIMER=0 bash scripts/install-public-data-retention-worker.sh
  timers_to_start+=(aic-public-data-retention-worker.timer)
else
  sudo systemctl disable --now aic-public-data-retention-worker.timer >/dev/null 2>&1 || true
fi

if [ "${INSTALL_PODCAST_SCHEDULED_WORKERS}" = "1" ]; then
  echo "Installing canonical daily podcast and Podtrac timers..."
  ENABLE_TIMERS=0 START_TIMERS=0 bash scripts/install-podcast-scheduled-workers.sh
  timers_to_start+=(aic-podcast-daily-ingest.timer aic-podtrac-daily-ingest.timer)
else
  sudo systemctl disable aic-podcast-daily-ingest.timer aic-podtrac-daily-ingest.timer >/dev/null 2>&1 || true
fi

# The backup timer stays disabled until this deployment has created and
# offline-verified a canonical backup set below.
sudo systemctl disable --now aic-strapi-backup.timer >/dev/null 2>&1 || true

if [ "${INSTALL_STRAPI_SERVICE}" = "0" ] && [[ "\${strapi_was_active}" == "1" ]]; then
  echo "Restarting the previously active private Strapi service..."
  sudo systemctl restart aic-strapi.service
fi

echo "Restarting service: ${REMOTE_SERVICE}"
sudo systemctl restart "${REMOTE_SERVICE}"
sudo systemctl is-active "${REMOTE_SERVICE}"
sleep 1

echo "Checking health on ${SERVICE_URL}"
curl -fsS "${SERVICE_URL}/"
curl -fsS "${SERVICE_URL}/login" >/dev/null
if [ "${INSTALL_STRAPI_SERVICE}" = "1" ] || \
   [ "${INSTALL_SCHEDULED_PUBLICATION_WORKER}" = "1" ] || \
   [ "${INSTALL_EPISODE_PUBLISH_WORKER}" = "1" ] || \
   [[ "\${strapi_was_active}" == "1" ]]; then
  echo "Checking required private Strapi health before any dependent timer starts..."
  sudo systemctl is-active --quiet aic-strapi.service
  wait_for_strapi_health
fi

if [ "${INSTALL_STRAPI_SERVICE}" = "1" ] && [ "${RUN_STRAPI_BACKUP_VERIFY}" = "1" ]; then
  echo "Running and verifying the post-health schema-scoped Strapi backup..."
  sudo systemctl start aic-strapi-backup.service
  sudo /usr/local/libexec/aic-strapi/verify-strapi-backup.sh
  sudo systemctl enable aic-strapi-backup.timer
  timers_to_start+=(aic-strapi-backup.timer)
elif [ "${INSTALL_STRAPI_SERVICE}" = "1" ]; then
  echo "Backup verification was skipped; the Strapi backup timer remains disabled."
fi

if [[ "\${#timers_to_start[@]}" -gt 0 ]]; then
  echo "Starting verified worker and backup timers..."
  sudo systemctl start "\${timers_to_start[@]}"
  for timer in "\${timers_to_start[@]}"; do
    sudo systemctl is-active "\${timer}"
  done
fi

if [ "${INSTALL_PODCAST_SCHEDULED_WORKERS}" = "1" ]; then
  echo "Enabling verified canonical podcast timers..."
  sudo systemctl enable aic-podcast-daily-ingest.timer aic-podtrac-daily-ingest.timer
  echo "Removing only the two exact legacy podcast cron commands after replacement timers are active..."
  bash scripts/migrate-legacy-podcast-cron.sh
fi

if [ "${INSTALL_CONTACT_EMAIL_WORKER}" = "1" ] && [[ "\${contact_email_ready}" == "1" ]]; then
  echo "Enabling accepted public contact SMTP notification timer..."
  sudo systemctl enable --now aic-contact-email-worker.timer
  sudo systemctl is-enabled --quiet aic-contact-email-worker.timer
  sudo systemctl is-active --quiet aic-contact-email-worker.timer
fi

trap - EXIT INT TERM
echo "Done."
SSH
