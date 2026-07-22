#!/usr/bin/env bash
set -euo pipefail
umask 077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
default_worktree="$(cd -- "${script_dir}/../.." && pwd -P)"
worktree="${STRAPI_CONTRACT_WORKTREE:-${default_worktree}}"
postgres_container="${STRAPI_POSTGRES_CONTAINER:-farm-postgres}"
db_name="aic_strapi_contract_$$"
db_role="aic_strapi_contract_$$"
db_password="$(openssl rand -hex 32)"
run_pid=""

case "${worktree}" in
  /mnt/storage/aic|/mnt/storage/aic-worktrees/*) ;;
  *) echo "Refusing unexpected Strapi contract worktree: ${worktree}" >&2; exit 1 ;;
esac

cleanup() {
  if [[ -n "${run_pid}" ]]; then
    kill -TERM -- "-${run_pid}" >/dev/null 2>&1 || true
    sleep 1
    kill -KILL -- "-${run_pid}" >/dev/null 2>&1 || true
  fi
  sudo rm -f /run/aic-strapi/aic-api-token /run/aic-strapi/aic-api-token.tmp
  {
    printf 'DROP DATABASE IF EXISTS %s WITH (FORCE);\n' "${db_name}"
    printf 'DROP ROLE IF EXISTS %s;\n' "${db_role}"
  } | docker exec -i "${postgres_container}" sh -lc \
    'psql -X --set ON_ERROR_STOP=1 --quiet -U "$POSTGRES_USER" -d postgres' >/dev/null 2>&1 || true
}
trap cleanup EXIT

{
  printf "CREATE ROLE %s LOGIN PASSWORD '%s' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;\n" \
    "${db_role}" "${db_password}"
  printf 'CREATE DATABASE %s OWNER %s;\n' "${db_name}" "${db_role}"
} | docker exec -i "${postgres_container}" sh -lc \
  'psql -X --set ON_ERROR_STOP=1 --quiet -U "$POSTGRES_USER" -d postgres'

sudo install -d -o ammonsfarm -g ammonsfarm -m 0700 /run/aic-strapi
cd "${worktree}/services/jimwood-cms"

export NODE_ENV=production
export HOST=127.0.0.1
export PORT=1338
export PUBLIC_URL=
export APP_KEYS="$(openssl rand -hex 32),$(openssl rand -hex 32),$(openssl rand -hex 32),$(openssl rand -hex 32)"
export API_TOKEN_SALT="$(openssl rand -hex 32)"
export ADMIN_JWT_SECRET="$(openssl rand -hex 32)"
export TRANSFER_TOKEN_SALT="$(openssl rand -hex 32)"
export JWT_SECRET="$(openssl rand -hex 32)"
export ENCRYPTION_KEY="$(openssl rand -hex 16)"
export DATABASE_CLIENT=postgres
export DATABASE_HOST=127.0.0.1
export DATABASE_PORT=5433
export DATABASE_NAME="${db_name}"
export DATABASE_USERNAME="${db_role}"
export DATABASE_PASSWORD="${db_password}"
export DATABASE_SSL=false
export AIC_API_TOKEN_OUTPUT_FILE=/run/aic-strapi/aic-api-token
export FLAG_NPS=false
export FLAG_PROMOTE_EE=false
export FLAG_DOC_LINKS=false

setsid npm start >/tmp/aic-strapi-contract.log 2>&1 &
run_pid=$!
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:1338/_health >/dev/null 2>&1 && [[ -s /run/aic-strapi/aic-api-token ]]; then
    break
  fi
  if ! kill -0 "${run_pid}" 2>/dev/null; then
    sed -n '1,220p' /tmp/aic-strapi-contract.log >&2
    exit 1
  fi
  sleep 2
done

curl -fsS http://127.0.0.1:1338/_health >/dev/null
token="$(tr -d '\r\n' < /run/aic-strapi/aic-api-token)"
if [[ ! "${token}" =~ ^[0-9a-f]{256}$ ]]; then
  echo "Managed API token has an unexpected format." >&2
  exit 1
fi

AIC_PROBE_TOKEN="${token}" node -e \
  'const response = await fetch("http://127.0.0.1:1338/api/pages?pagination[pageSize]=1", { headers: { Authorization: `Bearer ${process.env.AIC_PROBE_TOKEN}` } }); if (response.status !== 200) throw new Error(`managed token probe returned ${response.status}`);'

token_rows="$(docker exec "${postgres_container}" sh -lc \
  "psql -X -At -U \"\$POSTGRES_USER\" -d ${db_name} -c \"select name || ':' || type from strapi_api_tokens order by name\"")"
if [[ "${token_rows}" != "AIC content manager:custom" ]]; then
  echo "Unexpected API token registry after bootstrap." >&2
  exit 1
fi

echo "Strapi contract start passed: private health, custom-token API access, and broad defaults revoked."
