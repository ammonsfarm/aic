import "server-only";
import { Pool, type QueryResultRow } from "pg";

const requiredDbEnv = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"] as const;

type DbEnvKey = (typeof requiredDbEnv)[number];

export class MissingDatabaseEnvError extends Error {
  missing: DbEnvKey[];

  constructor(missing: DbEnvKey[]) {
    super(`Missing database environment: ${missing.join(", ")}`);
    this.name = "MissingDatabaseEnvError";
    this.missing = missing;
  }
}

declare global {
  var aicPostgresPool: Pool | undefined;
}

function readDbEnv() {
  const missing = requiredDbEnv.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new MissingDatabaseEnvError(missing);
  }

  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
}

export function getPool() {
  if (!globalThis.aicPostgresPool) {
    globalThis.aicPostgresPool = new Pool({
      ...readDbEnv(),
      max: 6,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  return globalThis.aicPostgresPool;
}

export async function queryRows<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  const result = await getPool().query<T>(text, values);
  return result.rows;
}
