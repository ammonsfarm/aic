export const CANONICAL_AIC_ENV_FILE = "/mnt/storage/aic/.env";
export const EXPECTED_DATABASE_HOST = "192.168.1.106";
export const EXPECTED_DATABASE_PORT = 5432;

export const requiredDatabaseEnv = [
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
] as const;

export type DatabaseEnvKey = (typeof requiredDatabaseEnv)[number];

export type DatabaseConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

export class MissingDatabaseEnvError extends Error {
  missing: DatabaseEnvKey[];

  constructor(missing: DatabaseEnvKey[]) {
    super(`Missing database environment: ${missing.join(", ")}`);
    this.name = "MissingDatabaseEnvError";
    this.missing = missing;
  }
}

function isDatabaseRoutingKey(key: string) {
  return key === "DATABASE_URL" || key.startsWith("PG");
}

function unquote(value: string) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    trimmed[0] === trimmed[trimmed.length - 1] &&
    (trimmed[0] === '"' || trimmed[0] === "'")
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseCanonicalDatabaseEnv(text: string): DatabaseConfig {
  const values = new Map<string, string>();
  const seenDatabaseKeys = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line.startsWith("export ")) line = line.slice("export ".length).trimStart();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Canonical AIC environment contains an invalid key: ${JSON.stringify(key)}`);
    }
    if (isDatabaseRoutingKey(key)) {
      throw new Error(`Canonical AIC environment must not declare database routing key: ${key}`);
    }
    if ((requiredDatabaseEnv as readonly string[]).includes(key)) {
      if (seenDatabaseKeys.has(key)) {
        throw new Error(`Canonical AIC environment contains duplicate sensitive key: ${key}`);
      }
      seenDatabaseKeys.add(key);
    }
    values.set(key, unquote(value));
  }

  const missing = requiredDatabaseEnv.filter((key) => !values.get(key));
  if (missing.length > 0) throw new MissingDatabaseEnvError([...missing]);

  const host = values.get("DB_HOST")!;
  const portText = values.get("DB_PORT")!;
  if (host !== EXPECTED_DATABASE_HOST || portText !== String(EXPECTED_DATABASE_PORT)) {
    throw new Error(
      `AIC production database must remain the existing PostgreSQL target at ${EXPECTED_DATABASE_HOST}:${EXPECTED_DATABASE_PORT}.`,
    );
  }

  return {
    host,
    port: EXPECTED_DATABASE_PORT,
    database: values.get("DB_NAME")!,
    user: values.get("DB_USER")!,
    password: values.get("DB_PASSWORD")!,
  };
}

function databaseConfigFromProcessEnv(environment: NodeJS.ProcessEnv): DatabaseConfig {
  const missing = requiredDatabaseEnv.filter((key) => !environment[key]);
  if (missing.length > 0) throw new MissingDatabaseEnvError([...missing]);
  const port = Number(environment.DB_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("DB_PORT must be an integer from 1 through 65535.");
  }
  return {
    host: environment.DB_HOST!,
    port,
    database: environment.DB_NAME!,
    user: environment.DB_USER!,
    password: environment.DB_PASSWORD!,
  };
}

export function resolveDatabaseConfig(
  nodeEnv: string | undefined,
  environment: NodeJS.ProcessEnv,
  canonicalText?: string,
): DatabaseConfig {
  if (nodeEnv === "production") {
    if (canonicalText === undefined) {
      throw new Error(`Production database settings must be read from ${CANONICAL_AIC_ENV_FILE}.`);
    }
    return parseCanonicalDatabaseEnv(canonicalText);
  }
  return databaseConfigFromProcessEnv(environment);
}
