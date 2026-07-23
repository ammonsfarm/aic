import { describe, expect, it } from "vitest";
import {
  CANONICAL_AIC_ENV_FILE,
  parseCanonicalDatabaseEnv,
  resolveDatabaseConfig,
} from "@/lib/database-env";

const canonicalText = [
  "DB_HOST=192.168.1.106",
  "DB_PORT=5432",
  "DB_NAME=aic",
  "DB_USER=aic_user",
  "DB_PASSWORD=canonical-password",
  "",
].join("\n");

describe("production database authority", () => {
  it("ignores hostile inherited DB and libpq routing values in favor of the canonical file", () => {
    const hostile = {
      NODE_ENV: "production",
      DB_HOST: "203.0.113.55",
      DB_PORT: "6543",
      DB_NAME: "copied_database",
      DB_USER: "wrong_user",
      DB_PASSWORD: "wrong-password",
      DATABASE_URL: "postgresql://wrong.invalid/copied_database",
      PGHOST: "wrong.invalid",
      PGPORT: "6543",
      PGDATABASE: "copied_database",
      PGSERVICE: "wrong-service",
      PGOPTIONS: "-c search_path=wrong",
    } satisfies NodeJS.ProcessEnv;

    expect(resolveDatabaseConfig("production", hostile, canonicalText)).toEqual({
      host: "192.168.1.106",
      port: 5432,
      database: "aic",
      user: "aic_user",
      password: "canonical-password",
    });
  });

  it("rejects duplicate database keys and every declared URL or PG routing key", () => {
    expect(() => parseCanonicalDatabaseEnv(`${canonicalText}DB_NAME=copy\n`)).toThrow(
      "duplicate sensitive key: DB_NAME",
    );
    for (const key of ["DATABASE_URL", "PGHOST", "PGOPTIONS", "PGUNEXPECTEDROUTE"]) {
      expect(() => parseCanonicalDatabaseEnv(`${canonicalText}${key}=wrong\n`)).toThrow(
        `database routing key: ${key}`,
      );
    }
  });

  it("requires the exact existing host and port and a canonical file payload", () => {
    expect(() => parseCanonicalDatabaseEnv(canonicalText.replace("192.168.1.106", "127.0.0.1"))).toThrow(
      "192.168.1.106:5432",
    );
    expect(() => parseCanonicalDatabaseEnv(canonicalText.replace("DB_PORT=5432", "DB_PORT=5433"))).toThrow(
      "192.168.1.106:5432",
    );
    expect(() => resolveDatabaseConfig("production", { NODE_ENV: "production" }, undefined)).toThrow(
      CANONICAL_AIC_ENV_FILE,
    );
  });
});
