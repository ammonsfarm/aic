#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DATABASE_HOST:?DATABASE_HOST is required}"
: "${DATABASE_PORT:?DATABASE_PORT is required}"
: "${DATABASE_NAME:?DATABASE_NAME is required}"
: "${DATABASE_USERNAME:?DATABASE_USERNAME is required}"
: "${DATABASE_PASSWORD:?DATABASE_PASSWORD is required}"
: "${DATABASE_SCHEMA:?DATABASE_SCHEMA is required}"

if [[ "${DATABASE_SCHEMA}" != "aic_strapi" ]]; then
  echo "Refusing unexpected Strapi schema: ${DATABASE_SCHEMA}" >&2
  exit 1
fi
if [[ "${DATABASE_HOST}" != "192.168.1.106" || "${DATABASE_PORT}" != "5432" ]]; then
  echo "Refusing any PostgreSQL target other than 192.168.1.106:5432." >&2
  exit 1
fi

docker_bin="${STRAPI_POSTGRES_DOCKER_BIN:-/usr/bin/docker}"
postgres_client_image="${STRAPI_POSTGRES_CLIENT_IMAGE:-postgres:16}"

if [[ ! -x "${docker_bin}" ]]; then
  echo "Docker is required at ${docker_bin}." >&2
  exit 1
fi
if ! "${docker_bin}" image inspect "${postgres_client_image}" >/dev/null 2>&1; then
  echo "Required local PostgreSQL client image is missing: ${postgres_client_image}" >&2
  echo "Install it explicitly; schema provisioning never pulls images." >&2
  exit 1
fi

docker_safety=(
  --rm
  --pull=never
  --read-only
  --cap-drop ALL
  --security-opt no-new-privileges
  --user "$(id -u ammonsfarm):$(id -g ammonsfarm)"
)

"${docker_bin}" run \
  "${docker_safety[@]}" \
  --network host \
  --env PGPASSWORD \
  "${postgres_client_image}" \
  psql \
  --no-password \
  --set ON_ERROR_STOP=1 \
  --host "${DATABASE_HOST}" \
  --port "${DATABASE_PORT}" \
  --username "${DATABASE_USERNAME}" \
  --dbname "${DATABASE_NAME}" \
  --command "CREATE SCHEMA IF NOT EXISTS ${DATABASE_SCHEMA} AUTHORIZATION CURRENT_USER; DO \$\$ DECLARE actual_owner name; BEGIN SELECT pg_get_userbyid(nspowner) INTO actual_owner FROM pg_namespace WHERE nspname = '${DATABASE_SCHEMA}'; IF actual_owner IS DISTINCT FROM current_user THEN RAISE EXCEPTION 'Schema ${DATABASE_SCHEMA} is owned by %, expected %', actual_owner, current_user; END IF; END \$\$; REVOKE ALL ON SCHEMA ${DATABASE_SCHEMA} FROM PUBLIC; GRANT USAGE, CREATE ON SCHEMA ${DATABASE_SCHEMA} TO CURRENT_USER;"

echo "Prepared the aic_strapi schema in the existing AIC PostgreSQL database."
