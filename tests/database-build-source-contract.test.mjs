import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const databaseBoundary = readFileSync("lib/database-runtime-boundary.ts", "utf8");
const databaseClient = readFileSync("lib/db.ts", "utf8");
const nextConfig = readFileSync("next.config.ts", "utf8");

test("the build phase remains a runtime lookup instead of a bundled constant", () => {
  assert.match(databaseBoundary, /NEXT_PHASE_ENV_KEY = \["NEXT", "PHASE"\]\.join\("_"\)/);
  assert.match(databaseBoundary, /Reflect\.get\(environment, NEXT_PHASE_ENV_KEY\)/);
  assert.match(nextConfig, /Reflect\.set\(process\.env, NEXT_PHASE_ENV_KEY, phase\)/);
  assert.doesNotMatch(databaseBoundary, /process\.env\.NEXT_PHASE/);
  assert.doesNotMatch(nextConfig, /process\.env\.NEXT_PHASE/);
});

test("the database guard runs before credentials, pool reuse, or construction", () => {
  const getPoolStart = databaseClient.indexOf("export function getPool()");
  const guard = databaseClient.indexOf("assertDatabaseRuntimeAccess();", getPoolStart);
  const existingPool = databaseClient.indexOf("globalThis.aicPostgresPool", guard);
  const construction = databaseClient.indexOf("new Pool(", guard);

  assert.ok(getPoolStart >= 0);
  assert.ok(guard > getPoolStart);
  assert.ok(existingPool > guard);
  assert.ok(construction > existingPool);
  assert.match(databaseClient, /readFileSync\(CANONICAL_AIC_ENV_FILE, "utf8"\)/);
});
