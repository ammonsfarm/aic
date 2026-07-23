#!/usr/bin/env bash
set -euo pipefail

canonical_aic_env="/mnt/storage/aic/.env"
test_mode="${STRAPI_DATABASE_ENV_TEST_MODE:-0}"

case "${test_mode}" in
  0|1) ;;
  *)
    echo "STRAPI_DATABASE_ENV_TEST_MODE must be 0 or 1." >&2
    exit 1
    ;;
esac
if [[ "${test_mode}" == "1" && "${NODE_ENV:-}" == "production" ]]; then
  echo "Test database context overrides are forbidden in production." >&2
  exit 1
fi
if [[ "${test_mode}" == "1" ]]; then
  if [[ "${NODE_ENV:-}" != "test" ||
        "${STRAPI_NATIVE_CLIENT_TEST_MODE:-}" != "1" ||
        -z "${STRAPI_POSTGRES_CLIENT_ROOT:-}" ||
        "${STRAPI_POSTGRES_CLIENT_ROOT}" == "/usr/lib/postgresql/16/bin" ||
        ! -d "${STRAPI_POSTGRES_CLIENT_ROOT}" ]]; then
    echo "Alternate database comparison files require NODE_ENV=test and an explicit non-production stub client root." >&2
    exit 1
  fi
fi

if [[ "${test_mode}" == "1" ]]; then
  comparison_env="${STRAPI_AIC_ENV_FILE:-}"
  if [[ -z "${comparison_env}" ]]; then
    echo "Test database context requires an explicit STRAPI_AIC_ENV_FILE." >&2
    exit 1
  fi
else
  comparison_env="${canonical_aic_env}"
  if [[ -n "${STRAPI_AIC_ENV_FILE:-}" && "${STRAPI_AIC_ENV_FILE}" != "${canonical_aic_env}" ]]; then
    echo "Production database context must use ${canonical_aic_env}." >&2
    exit 1
  fi
fi
if [[ ! -f "${comparison_env}" ]]; then
  echo "Canonical AIC database environment is missing: ${comparison_env}" >&2
  exit 1
fi

guard="${AIC_CANONICAL_DB_GUARD:-}"
if [[ ! "${guard}" =~ ^[0-9]+:[0-9a-f]{64}$ ]] ||
   [[ "${guard%%:*}" != "${BASHPID}" ]]; then
  echo "This database operation must be entered through with-aic-db-env.sh." >&2
  exit 1
fi

canonical_values=()
mapfile -d '' -t canonical_values < <(
  /usr/bin/python3 - "${comparison_env}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
database_keys = ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD")
routing_keys = (
    "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD",
    "PGPASSFILE", "PGSERVICE", "PGSERVICEFILE", "DATABASE_URL",
)
sensitive_keys = {*database_keys, *routing_keys}
seen_sensitive: set[str] = set()
values: dict[str, str] = {}
for raw_line in path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if line.startswith("export "):
        line = line.removeprefix("export ").lstrip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    key = key.strip()
    if key in sensitive_keys:
        if key in seen_sensitive:
            raise SystemExit(f"Duplicate sensitive database environment key: {key}")
        seen_sensitive.add(key)
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
    values[key] = value

if any(not values.get(key) for key in database_keys):
    raise SystemExit(2)
for key in database_keys:
    sys.stdout.buffer.write(values[key].encode("utf-8") + b"\0")
PY
)
if [[ "${#canonical_values[@]}" -ne 5 ]]; then
  echo "Could not independently load the five canonical database values from ${comparison_env}." >&2
  exit 1
fi

expected_host="${canonical_values[0]}"
expected_port="${canonical_values[1]}"
expected_name="${canonical_values[2]}"
expected_user="${canonical_values[3]}"
expected_password="${canonical_values[4]}"
if [[ "${expected_host}" != "192.168.1.106" || "${expected_port}" != "5432" ]]; then
  echo "Canonical AIC PostgreSQL must remain at 192.168.1.106:5432." >&2
  exit 1
fi

if [[ "${DATABASE_CLIENT:-}" != "postgres" ||
      "${DATABASE_HOST:-}" != "${expected_host}" ||
      "${DATABASE_PORT:-}" != "${expected_port}" ||
      "${DATABASE_NAME:-}" != "${expected_name}" ||
      "${DATABASE_USERNAME:-}" != "${expected_user}" ||
      "${DATABASE_PASSWORD:-}" != "${expected_password}" ||
      "${DATABASE_SCHEMA:-}" != "aic_strapi" ]]; then
  echo "Database operation context does not exactly match ${comparison_env} and schema aic_strapi." >&2
  exit 1
fi
if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is forbidden for exact-target AIC database operations." >&2
  exit 1
fi
if [[ "${PGHOST:-}" != "${expected_host}" ||
      "${PGPORT:-}" != "${expected_port}" ||
      "${PGDATABASE:-}" != "${expected_name}" ||
      "${PGUSER:-}" != "${expected_user}" ||
      "${PGPASSWORD:-}" != "${expected_password}" ]]; then
  echo "libpq target variables do not exactly match the canonical AIC database context." >&2
  exit 1
fi
for forbidden in PGHOSTADDR PGSERVICE PGSERVICEFILE PGPASSFILE; do
  if [[ -n "${!forbidden+x}" ]]; then
    echo "Independent libpq routing variable ${forbidden} is forbidden." >&2
    exit 1
  fi
done

unset expected_password
