"""Authoritative production database environment handling for AIC workers.

Production callers read the existing database settings from exactly
``/mnt/storage/aic/.env``. Tests may opt into a temporary path only through the
explicit function argument used by unit tests; no inherited environment flag
can switch a production caller to another file.
"""

from __future__ import annotations

import os
from pathlib import Path


CANONICAL_AIC_ENV = Path("/mnt/storage/aic/.env")
EXPECTED_DB_HOST = "192.168.1.106"
EXPECTED_DB_PORT = "5432"
DEFAULT_CONNECT_TIMEOUT_SECONDS = 5
DATABASE_ENV_KEYS = (
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
)
STRAPI_MUTATION_ENV_KEYS = (
    "STRAPI_URL",
    "STRAPI_MANAGEMENT_URL",
    "STRAPI_PUBLIC_URL",
    "STRAPI_API_TOKEN",
    "STRAPI_READ_TOKEN",
    "STRAPI_MANAGEMENT_TOKEN",
    "STRAPI_API_TOKEN_TEMP_WRITE",
)
SUBSCRIPTION_PROVIDER_ENV_KEYS = (
    "MAILCHIMP_API_KEY",
    "MAILCHIMP_SERVER_PREFIX",
    "MAILCHIMP_AUDIENCE_ID",
    "MAILCHIMP_WEBHOOK_SECRET",
    "SUBSCRIPTION_RATE_LIMIT_SECRET",
    "SUBSCRIPTION_UNSUBSCRIBE_SECRET",
)


def _parse_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise RuntimeError(f"Canonical AIC environment is missing: {path}")

    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line.startswith("export "):
            line = line.removeprefix("export ").lstrip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def load_canonical_aic_env(
    path: Path | str = CANONICAL_AIC_ENV,
    *,
    allow_test_path: bool = False,
) -> dict[str, str]:
    """Load AIC settings while making the five DB values file-authoritative."""

    selected = Path(path)
    if not allow_test_path and selected != CANONICAL_AIC_ENV:
        raise RuntimeError(f"Production database settings must come from {CANONICAL_AIC_ENV}.")

    values = _parse_env_file(selected)
    missing = [key for key in DATABASE_ENV_KEYS if not values.get(key)]
    if missing:
        raise RuntimeError(
            "Canonical AIC environment is missing required database settings: "
            + ", ".join(missing)
        )
    if values["DB_HOST"] != EXPECTED_DB_HOST or values["DB_PORT"] != EXPECTED_DB_PORT:
        raise RuntimeError(
            "AIC production database must remain the existing PostgreSQL target at "
            f"{EXPECTED_DB_HOST}:{EXPECTED_DB_PORT}."
        )

    for key in (*DATABASE_ENV_KEYS, *STRAPI_MUTATION_ENV_KEYS, *SUBSCRIPTION_PROVIDER_ENV_KEYS):
        os.environ.pop(key, None)
    for key in DATABASE_ENV_KEYS:
        os.environ[key] = values[key]
    for key, value in values.items():
        if key in (*STRAPI_MUTATION_ENV_KEYS, *SUBSCRIPTION_PROVIDER_ENV_KEYS):
            os.environ[key] = value
        elif key not in DATABASE_ENV_KEYS:
            os.environ.setdefault(key, value)
    return dict(values)


def database_dsn(*, application_name: str, connect_timeout: int = DEFAULT_CONNECT_TIMEOUT_SECONDS) -> str:
    missing = [key for key in DATABASE_ENV_KEYS if not os.environ.get(key)]
    if missing:
        raise RuntimeError("Database environment has not been loaded: " + ", ".join(missing))
    if os.environ["DB_HOST"] != EXPECTED_DB_HOST or os.environ["DB_PORT"] != EXPECTED_DB_PORT:
        raise RuntimeError(
            "AIC production database must remain the existing PostgreSQL target at "
            f"{EXPECTED_DB_HOST}:{EXPECTED_DB_PORT}."
        )
    def quote(value: str) -> str:
        return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"

    settings = {
        "host": os.environ["DB_HOST"],
        "port": os.environ["DB_PORT"],
        "dbname": os.environ["DB_NAME"],
        "user": os.environ["DB_USER"],
        "password": os.environ["DB_PASSWORD"],
        "connect_timeout": str(max(1, min(int(connect_timeout), 30))),
        "application_name": application_name,
    }
    return " ".join(f"{key}={quote(value)}" for key, value in settings.items())
