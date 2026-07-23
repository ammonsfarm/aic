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
INSTALL_SCHEDULED_PUBLICATION_WORKER="${INSTALL_SCHEDULED_PUBLICATION_WORKER:-1}"
SERVICE_URL="http://127.0.0.1:${REMOTE_PORT}"

for toggle in \
  "${INSTALL_TRANSCRIPT_EDIT_WORKER}" \
  "${INSTALL_STRAPI_SERVICE}" \
  "${RUN_STRAPI_BACKUP_VERIFY}" \
  "${INSTALL_ADMIN_OPERATIONS_WORKER}" \
  "${INSTALL_EPISODE_PUBLISH_WORKER}" \
  "${INSTALL_SUBSCRIPTION_PROVIDER_WORKER}" \
  "${INSTALL_SCHEDULED_PUBLICATION_WORKER}"; do
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
    /usr/lib/postgresql/16/bin/psql \
    --no-password --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --no-align \
    --command 'set transaction read only; select 1;'
)"
if [[ "\${preflight_result}" != "SET
1" && "\${preflight_result}" != "1" ]]; then
  echo "Existing AIC PostgreSQL preflight returned an unexpected result; aborting before checkout mutation." >&2
  exit 1
fi

echo "Updating code..."
previous_sha="\$(git rev-parse HEAD)"
echo "Previous application revision: \${previous_sha}"
git fetch --all
git checkout "${REMOTE_BRANCH}"
git pull --ff-only origin "${REMOTE_BRANCH}"

echo "Installing dependencies..."
npm ci
npm --prefix services/jimwood-cms ci

echo "Preparing the canonical Python worker runtime..."
if [[ ! -x .venv-pg/bin/python ]]; then
  python3 -m venv .venv-pg
fi
.venv-pg/bin/python -m pip install -r requirements-postgres.txt

echo "Running release tests and builds before database or service mutation..."
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
echo "Installing root-owned Strapi operations..."
sudo install -o root -g root -m 0755 \
  ops/strapi/install-strapi-ops.sh \
  /usr/local/sbin/aic-install-strapi-ops
sudo /usr/local/sbin/aic-install-strapi-ops

echo "Validating the existing AIC PostgreSQL target..."
/usr/local/libexec/aic-strapi/with-aic-db-env.sh /usr/bin/true

echo "Applying database migrations..."
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
fi

if [ "${INSTALL_ADMIN_OPERATIONS_WORKER}" = "1" ]; then
  echo "Installing allowlisted admin operations worker timer..."
  START_TIMER=0 bash scripts/install-admin-operations-worker.sh
  timers_to_start+=(aic-admin-operations-worker.timer)
fi

if [ "${INSTALL_EPISODE_PUBLISH_WORKER}" = "1" ]; then
  echo "Installing Strapi episode publication worker timer..."
  START_TIMER=0 bash scripts/install-episode-publish-worker.sh
  timers_to_start+=(aic-episode-publish-worker.timer)
fi

if [ "${INSTALL_SUBSCRIPTION_PROVIDER_WORKER}" = "1" ] && [[ "\${subscription_provider_ready}" == "1" ]]; then
  echo "Installing Mailchimp subscription provider worker timer..."
  START_TIMER=0 bash scripts/install-subscription-provider-worker.sh
  timers_to_start+=(aic-subscription-provider-worker.timer)
else
  echo "Subscription provider is incomplete; keeping its timer disabled and the public signup disabled."
  sudo systemctl disable --now aic-subscription-provider-worker.timer >/dev/null 2>&1 || true
fi

if [ "${INSTALL_SCHEDULED_PUBLICATION_WORKER}" = "1" ]; then
  echo "Installing scheduled Strapi publication worker timer..."
  START_TIMER=0 bash scripts/install-scheduled-publication-worker.sh
  timers_to_start+=(aic-scheduled-publication-worker.timer)
fi

if [ "${INSTALL_STRAPI_SERVICE}" = "1" ]; then
  timers_to_start+=(aic-strapi-backup.timer)
fi

echo "Restarting service: ${REMOTE_SERVICE}"
sudo systemctl restart "${REMOTE_SERVICE}"
sudo systemctl is-active "${REMOTE_SERVICE}"
sleep 1

echo "Checking health on ${SERVICE_URL}"
curl -fsS "${SERVICE_URL}/"
curl -fsS "${SERVICE_URL}/login" >/dev/null
if [ "${INSTALL_STRAPI_SERVICE}" = "1" ]; then
  curl -fsS http://127.0.0.1:1337/_health >/dev/null
fi

if [ "${INSTALL_STRAPI_SERVICE}" = "1" ] && [ "${RUN_STRAPI_BACKUP_VERIFY}" = "1" ]; then
  echo "Running and verifying the post-health schema-scoped Strapi backup..."
  sudo systemctl start aic-strapi-backup.service
  sudo /usr/local/libexec/aic-strapi/verify-strapi-backup.sh
fi

if [[ "\${#timers_to_start[@]}" -gt 0 ]]; then
  echo "Starting verified worker and backup timers..."
  sudo systemctl start "\${timers_to_start[@]}"
  for timer in "\${timers_to_start[@]}"; do
    sudo systemctl is-active "\${timer}"
  done
fi

echo "Done."
SSH
