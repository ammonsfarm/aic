import "server-only";
import { readFileSync } from "node:fs";
import { Pool, type QueryResultRow } from "pg";
import {
  CANONICAL_AIC_ENV_FILE,
  resolveDatabaseConfig,
} from "@/lib/database-env";

export { MissingDatabaseEnvError } from "@/lib/database-env";

declare global {
  var aicPostgresPool: Pool | undefined;
}

function readDbEnv() {
  const canonicalText = process.env.NODE_ENV === "production"
    ? readFileSync(CANONICAL_AIC_ENV_FILE, "utf8")
    : undefined;
  return resolveDatabaseConfig(process.env.NODE_ENV, process.env, canonicalText);
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
