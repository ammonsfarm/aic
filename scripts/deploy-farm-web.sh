#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-farm}"
REMOTE_USER="${REMOTE_USER:-ammonsfarm}"
REMOTE_DIR="${REMOTE_DIR:-/mnt/storage/aic}"
REMOTE_BRANCH="${REMOTE_BRANCH:-main}"
REMOTE_SERVICE="${REMOTE_SERVICE:-aic-web.service}"
REMOTE_PORT="${REMOTE_PORT:-8087}"
INSTALL_TRANSCRIPT_EDIT_WORKER="${INSTALL_TRANSCRIPT_EDIT_WORKER:-1}"
INSTALL_ADMIN_OPERATIONS_WORKER="${INSTALL_ADMIN_OPERATIONS_WORKER:-1}"
SERVICE_URL="http://127.0.0.1:${REMOTE_PORT}"

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

echo "Updating code..."
cd "${REMOTE_DIR}"
git fetch --all
git checkout "${REMOTE_BRANCH}"
git pull --ff-only origin "${REMOTE_BRANCH}"

echo "Installing dependencies..."
npm ci

echo "Applying database migrations..."
MIGRATION_PYTHON="python3"
if ! python3 - <<'PY'
import psycopg
PY
then
  python3 -m venv .venv-pg
  .venv-pg/bin/python -m pip install -r requirements-postgres.txt
  MIGRATION_PYTHON=".venv-pg/bin/python"
fi
"\${MIGRATION_PYTHON}" apply_postgres_migrations.py

echo "Building Next.js app..."
npm run build

if [ "${INSTALL_TRANSCRIPT_EDIT_WORKER}" = "1" ]; then
  echo "Installing transcript edit worker timer..."
  bash scripts/install-transcript-edit-worker.sh
fi

if [ "${INSTALL_ADMIN_OPERATIONS_WORKER}" = "1" ]; then
  echo "Installing allowlisted admin operations worker timer..."
  bash scripts/install-admin-operations-worker.sh
fi

echo "Restarting service: ${REMOTE_SERVICE}"
sudo systemctl restart "${REMOTE_SERVICE}"
sudo systemctl is-active "${REMOTE_SERVICE}"
sleep 1

echo "Checking health on ${SERVICE_URL}"
curl -fsS "${SERVICE_URL}/"

echo "Done."
SSH
