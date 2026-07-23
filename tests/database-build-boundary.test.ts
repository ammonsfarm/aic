import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  constructPool: vi.fn(),
  query: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: databaseMocks.readFileSync,
}));

vi.mock("pg", () => ({
  Pool: class MockPool {
    constructor(config: unknown) {
      databaseMocks.constructPool(config);
    }

    query(text: string, values: unknown[]) {
      return databaseMocks.query(text, values);
    }
  },
}));

import configureNext from "@/next.config";
import { CANONICAL_AIC_ENV_FILE } from "@/lib/database-env";
import { NEXT_PHASE_ENV_KEY } from "@/lib/database-runtime-boundary";
import {
  DatabaseAccessDuringBuildError,
  getPool,
  queryRows,
} from "@/lib/db";

const canonicalText = [
  "DB_HOST=192.168.1.106",
  "DB_PORT=5432",
  "DB_NAME=aic",
  "DB_USER=aic_user",
  "DB_PASSWORD=canonical-password",
  "",
].join("\n");

const originalNextPhase = Reflect.get(process.env, NEXT_PHASE_ENV_KEY);

describe("Next production-build database boundary", () => {
  beforeEach(() => {
    delete globalThis.aicPostgresPool;
    databaseMocks.readFileSync.mockReset();
    databaseMocks.constructPool.mockReset();
    databaseMocks.query.mockReset();
  });

  afterEach(() => {
    delete globalThis.aicPostgresPool;
    vi.unstubAllEnvs();
    if (originalNextPhase === undefined) {
      Reflect.deleteProperty(process.env, NEXT_PHASE_ENV_KEY);
    } else {
      Reflect.set(process.env, NEXT_PHASE_ENV_KEY, originalNextPhase);
    }
  });

  it("propagates Next's authoritative phase to server modules", () => {
    const config = configureNext("phase-production-build");

    expect(config).toBeDefined();
    expect(process.env.NEXT_PHASE).toBe("phase-production-build");
  });

  it("rejects build-time queries before reading the canonical env or constructing a pool", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");

    expect(() => getPool()).toThrow(DatabaseAccessDuringBuildError);
    await expect(queryRows("select 1")).rejects.toBeInstanceOf(DatabaseAccessDuringBuildError);
    expect(databaseMocks.readFileSync).not.toHaveBeenCalled();
    expect(databaseMocks.constructPool).not.toHaveBeenCalled();
    expect(databaseMocks.query).not.toHaveBeenCalled();
  });

  it("keeps production runtime pinned to the existing canonical database", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    vi.stubEnv("DB_HOST", "wrong.invalid");
    vi.stubEnv("DB_PORT", "6543");
    vi.stubEnv("DB_NAME", "copied_database");
    vi.stubEnv("DB_USER", "wrong_user");
    vi.stubEnv("DB_PASSWORD", "wrong-password");
    vi.stubEnv("DATABASE_URL", "postgresql://wrong.invalid/copied_database");
    vi.stubEnv("PGHOST", "wrong.invalid");
    databaseMocks.readFileSync.mockReturnValue(canonicalText);
    databaseMocks.query.mockResolvedValue({ rows: [{ value: 1 }] });

    getPool();
    await expect(queryRows<{ value: number }>("select $1::integer as value", [1])).resolves.toEqual([{ value: 1 }]);

    expect(databaseMocks.readFileSync).toHaveBeenCalledTimes(1);
    expect(databaseMocks.readFileSync).toHaveBeenCalledWith(CANONICAL_AIC_ENV_FILE, "utf8");
    expect(databaseMocks.constructPool).toHaveBeenCalledTimes(1);
    expect(databaseMocks.constructPool).toHaveBeenCalledWith({
      host: "192.168.1.106",
      port: 5432,
      database: "aic",
      user: "aic_user",
      password: "canonical-password",
      max: 6,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    expect(databaseMocks.query).toHaveBeenCalledWith("select $1::integer as value", [1]);
  });
});
