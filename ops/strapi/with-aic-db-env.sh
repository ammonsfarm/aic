#!/usr/bin/env bash
set -euo pipefail
umask 077

canonical_aic_env="/mnt/storage/aic/.env"
aic_env="${STRAPI_AIC_ENV_FILE:-${canonical_aic_env}}"
test_mode="${STRAPI_DATABASE_ENV_TEST_MODE:-0}"

case "${test_mode}" in
  0|1) ;;
  *)
    echo "STRAPI_DATABASE_ENV_TEST_MODE must be 0 or 1." >&2
    exit 1
    ;;
esac
if [[ "${test_mode}" == "1" && "${NODE_ENV:-}" == "production" ]]; then
  echo "Test database environment overrides are forbidden in production." >&2
  exit 1
fi
if [[ "${test_mode}" == "1" ]]; then
  if [[ "${NODE_ENV:-}" != "test" ||
        "${STRAPI_NATIVE_CLIENT_TEST_MODE:-}" != "1" ||
        -z "${STRAPI_POSTGRES_CLIENT_ROOT:-}" ||
        "${STRAPI_POSTGRES_CLIENT_ROOT}" == "/usr/lib/postgresql/16/bin" ||
        ! -d "${STRAPI_POSTGRES_CLIENT_ROOT}" ]]; then
    echo "Alternate database environment files require NODE_ENV=test and an explicit non-production stub client root." >&2
    exit 1
  fi
fi

if [[ "${test_mode}" == "0" && "${aic_env}" != "${canonical_aic_env}" ]]; then
  echo "Production Strapi must use ${canonical_aic_env}." >&2
  exit 1
fi
if [[ ! -f "${aic_env}" ]]; then
  echo "Canonical AIC database environment is missing: ${aic_env}" >&2
  exit 1
fi
if [[ "$#" -eq 0 ]]; then
  echo "A command is required." >&2
  exit 1
fi

# Parse only the five database values without sourcing the file. Other
# assignments cannot execute or overwrite NODE_ENV, Strapi application secrets,
# or service paths, and duplicate database/routing keys fail closed.
database_values=()
mapfile -d '' -t database_values < <(
  /usr/bin/python3 - "${aic_env}" <<'PY'
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
    raise SystemExit("Canonical AIC environment is missing a required database value.")
for key in database_keys:
    sys.stdout.buffer.write(values[key].encode("utf-8") + b"\0")
PY
)
if [[ "${#database_values[@]}" -ne 5 ]]; then
  echo "Could not load the five required database values from ${aic_env}." >&2
  exit 1
fi

unset DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD
DB_HOST="${database_values[0]}"
DB_PORT="${database_values[1]}"
DB_NAME="${database_values[2]}"
DB_USER="${database_values[3]}"
DB_PASSWORD="${database_values[4]}"
if [[ "${DB_HOST}" != "192.168.1.106" || "${DB_PORT}" != "5432" ]]; then
  echo "Strapi must use the existing AIC PostgreSQL target at 192.168.1.106:5432." >&2
  exit 1
fi

# DATABASE_URL is intentionally unsupported: it could silently repoint Strapi
# away from the exact AIC PostgreSQL target above.
unset DATABASE_URL
# libpq accepts independent address and service-file routing overrides. Remove
# them before exporting the exact canonical host, database, user, and password.
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGPASSFILE
export DATABASE_CLIENT=postgres
export DATABASE_HOST="${DB_HOST}"
export DATABASE_PORT="${DB_PORT}"
export DATABASE_NAME="${DB_NAME}"
export DATABASE_USERNAME="${DB_USER}"
export DATABASE_PASSWORD="${DB_PASSWORD}"
export DATABASE_SCHEMA=aic_strapi
export DATABASE_SSL=false
export DATABASE_POOL_MIN=1
export DATABASE_POOL_MAX=10
export DATABASE_CONNECTION_TIMEOUT=60000
export PGHOST="${DB_HOST}"
export PGPORT="${DB_PORT}"
export PGDATABASE="${DB_NAME}"
export PGUSER="${DB_USER}"
export PGPASSWORD="${DB_PASSWORD}"
export PGCONNECT_TIMEOUT=5

# Mark the exact wrapper process with a fresh, non-reusable guard. Internal
# schema and backup commands independently re-read the canonical file and
# require this PID-bound nonce, preventing accidental direct invocation.
unset AIC_CANONICAL_DB_GUARD
guard_nonce="$(/usr/bin/od -An -N32 -tx1 /dev/urandom | /usr/bin/tr -d ' \n')"
if [[ ! "${guard_nonce}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Could not generate the canonical database operation guard." >&2
  exit 1
fi
export AIC_CANONICAL_DB_GUARD="${BASHPID}:${guard_nonce}"

exec "$@"
