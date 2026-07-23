"""Authoritative production database environment handling for AIC workers.

Production callers read the existing database settings from exactly
``/mnt/storage/aic/.env``. Tests may opt into a temporary path only through the
explicit function argument used by unit tests; no inherited environment flag
can switch a production caller to another file.
"""

from __future__ import annotations

import os
from pathlib import Path
import re
from typing import Mapping


CANONICAL_AIC_ENV = Path("/mnt/storage/aic/.env")
CANONICAL_PODCAST_ENV = Path("/mnt/storage/aic_podcast/.env")
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
LIBPQ_ROUTING_ENV_KEYS = (
    "PGHOST",
    "PGHOSTADDR",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
    "PGPASSFILE",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGOPTIONS",
    "PGTARGETSESSIONATTRS",
    "PGSSLMODE",
)
DATABASE_ROUTING_ENV_KEYS = (*LIBPQ_ROUTING_ENV_KEYS, "DATABASE_URL")
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
ENV_KEY_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SENSITIVE_ENV_SUFFIXES = (
    "_API_KEY",
    "_APP_KEY",
    "_KEY",
    "_PASSWORD",
    "_SECRET",
    "_SESSION_TOKEN",
    "_TOKEN",
)
PODCAST_SUPPLEMENTAL_DECLARED_KEYS = {
    *DATABASE_ENV_KEYS,
    "CLERK_SECRET_KEY",
    "GEMINI_API_KEY",
    "GEMINI_API_KEY2",
    "MISTRAL_API_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "OPENAI_API_KEY",
    "OPENAI_EMBEDDING_MODEL",
    "OPENAI_RAG_MODEL",
    "OPENAI_REFRESH_TOKEN",
    "OPENAI_SESSION_TOKEN",
    "RAG_CHAT_APP_TOKEN",
    "RAG_CHAT_GPT_TOKEN",
    "SILO_TEMP_KEY",
    "YVP_APP_KEY",
}
PODCAST_SUBPROCESS_ENV_KEYS = {
    "MISTRAL_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_EMBEDDING_MODEL",
    "OPENAI_SESSION_TOKEN",
    "SILO_TEMP_KEY",
}
PROCESS_CONTROL_ENV_KEYS = {
    "BASH_ENV",
    "ENV",
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "NODE_OPTIONS",
    "PATH",
    "PERL5LIB",
    "PYTHONHOME",
    "PYTHONPATH",
    "RUBYLIB",
}
SAFE_SUBPROCESS_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"


def is_database_routing_key(key: str) -> bool:
    """Return true for libpq/URL settings that can alter a database connection."""

    return key == "DATABASE_URL" or key.startswith("PG")


def is_sensitive_env_key(key: str) -> bool:
    upper = key.upper()
    return (
        key in DATABASE_ENV_KEYS
        or is_database_routing_key(key)
        or upper.endswith(SENSITIVE_ENV_SUFFIXES)
    )


def database_routing_keys(values: Mapping[str, str]) -> list[str]:
    return sorted(key for key in values if is_database_routing_key(key))


def _parse_env_file(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise RuntimeError(f"Canonical AIC environment is missing: {path}")

    values: dict[str, str] = {}
    sensitive_keys = {*DATABASE_ENV_KEYS, *DATABASE_ROUTING_ENV_KEYS}
    seen_sensitive: set[str] = set()
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line.startswith("export "):
            line = line.removeprefix("export ").lstrip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not ENV_KEY_PATTERN.fullmatch(key):
            raise RuntimeError(f"Canonical AIC environment contains an invalid key: {key!r}")
        if key in sensitive_keys:
            if key in seen_sensitive:
                raise RuntimeError(f"Canonical AIC environment contains duplicate sensitive key: {key}")
            seen_sensitive.add(key)
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
    declared_routing = database_routing_keys(values)
    if declared_routing:
        raise RuntimeError(
            "Canonical AIC environment must not declare independent database routing settings: "
            + ", ".join(declared_routing)
        )
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

    for key in list(os.environ):
        if (
            key in DATABASE_ENV_KEYS
            or is_database_routing_key(key)
            or key in STRAPI_MUTATION_ENV_KEYS
            or key in SUBSCRIPTION_PROVIDER_ENV_KEYS
        ):
            os.environ.pop(key, None)
    for key in DATABASE_ENV_KEYS:
        os.environ[key] = values[key]
    for key, value in values.items():
        if key in (*STRAPI_MUTATION_ENV_KEYS, *SUBSCRIPTION_PROVIDER_ENV_KEYS):
            os.environ[key] = value
        elif key not in DATABASE_ENV_KEYS:
            os.environ.setdefault(key, value)
    return dict(values)


def load_supplemental_podcast_env(
    path: Path | str = CANONICAL_PODCAST_ENV,
    *,
    canonical_values: Mapping[str, str],
    allow_test_path: bool = False,
) -> dict[str, str]:
    """Load provider/runtime settings without granting a second DB authority.

    The legacy podcast environment currently carries one matching copy of each
    ``DB_*`` setting. Those copies are accepted only when they byte-match the
    canonical AIC values and are never returned or exported. Independent
    ``DATABASE_URL`` and ``PG*`` settings are rejected outright.
    """

    selected = Path(path)
    if not allow_test_path and selected != CANONICAL_PODCAST_ENV:
        raise RuntimeError(f"Podcast supplemental settings must come from {CANONICAL_PODCAST_ENV}.")
    if not selected.is_file():
        raise RuntimeError(f"Podcast supplemental environment is missing: {selected}")

    values: dict[str, str] = {}
    seen_sensitive: set[str] = set()
    for raw_line in selected.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if line.startswith("export "):
            line = line.removeprefix("export ").lstrip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not ENV_KEY_PATTERN.fullmatch(key):
            raise RuntimeError(f"Podcast supplemental environment contains an invalid key: {key!r}")
        if is_sensitive_env_key(key):
            if key in seen_sensitive:
                raise RuntimeError(f"Podcast supplemental environment contains duplicate sensitive key: {key}")
            seen_sensitive.add(key)
        if is_database_routing_key(key):
            raise RuntimeError(
                f"Podcast supplemental environment must not declare database routing key: {key}"
            )
        if key in PROCESS_CONTROL_ENV_KEYS or key.startswith("STRAPI_"):
            raise RuntimeError(
                f"Podcast supplemental environment must not control the worker process or Strapi: {key}"
            )
        if key not in PODCAST_SUPPLEMENTAL_DECLARED_KEYS:
            if is_sensitive_env_key(key):
                raise RuntimeError(f"Podcast supplemental environment contains unexpected sensitive key: {key}")
            raise RuntimeError(f"Podcast supplemental environment contains unsupported key: {key}")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value

    for key in DATABASE_ENV_KEYS:
        if key in values and values[key] != canonical_values.get(key):
            raise RuntimeError(
                f"Podcast supplemental environment {key} does not match the canonical AIC environment."
            )

    return {key: values[key] for key in PODCAST_SUBPROCESS_ENV_KEYS if key in values}


def canonical_subprocess_env(
    canonical_values: Mapping[str, str],
    supplemental_values: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Build a child environment that cannot inherit an alternate DB route."""

    missing = [key for key in DATABASE_ENV_KEYS if not canonical_values.get(key)]
    if missing:
        raise RuntimeError(
            "Canonical AIC environment is missing required database settings: " + ", ".join(missing)
        )
    if (
        canonical_values["DB_HOST"] != EXPECTED_DB_HOST
        or canonical_values["DB_PORT"] != EXPECTED_DB_PORT
    ):
        raise RuntimeError(
            "AIC production database must remain the existing PostgreSQL target at "
            f"{EXPECTED_DB_HOST}:{EXPECTED_DB_PORT}."
        )

    child = dict(os.environ)
    for key in list(child):
        if (
            key in DATABASE_ENV_KEYS
            or is_database_routing_key(key)
            or key in PROCESS_CONTROL_ENV_KEYS
            or key.startswith("STRAPI_")
        ):
            child.pop(key, None)
    child["PATH"] = SAFE_SUBPROCESS_PATH
    for key, value in (supplemental_values or {}).items():
        if key in DATABASE_ENV_KEYS or is_database_routing_key(key):
            raise RuntimeError(f"Supplemental subprocess setting cannot control the database: {key}")
        if key in PROCESS_CONTROL_ENV_KEYS or key.startswith("STRAPI_"):
            raise RuntimeError(f"Supplemental subprocess setting cannot control the process or Strapi: {key}")
        child[key] = value
    for key in DATABASE_ENV_KEYS:
        child[key] = canonical_values[key]
    return child


def database_dsn(*, application_name: str, connect_timeout: int = DEFAULT_CONNECT_TIMEOUT_SECONDS) -> str:
    missing = [key for key in DATABASE_ENV_KEYS if not os.environ.get(key)]
    if missing:
        raise RuntimeError("Database environment has not been loaded: " + ", ".join(missing))
    if os.environ["DB_HOST"] != EXPECTED_DB_HOST or os.environ["DB_PORT"] != EXPECTED_DB_PORT:
        raise RuntimeError(
            "AIC production database must remain the existing PostgreSQL target at "
            f"{EXPECTED_DB_HOST}:{EXPECTED_DB_PORT}."
        )
    inherited_routing = database_routing_keys(os.environ)
    if inherited_routing:
        raise RuntimeError(
            "Independent libpq routing settings are forbidden after loading the canonical AIC environment: "
            + ", ".join(inherited_routing)
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
