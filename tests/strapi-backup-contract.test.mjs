import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const backupScript = join(repoRoot, "ops", "strapi", "backup-strapi.sh");
const databaseWrapper = join(repoRoot, "ops", "strapi", "with-aic-db-env.sh");

test("Strapi backup dry run uses pinned native PostgreSQL 16 clients without side effects", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aic-strapi-backup-contract-"));
  const clientLog = join(sandbox, "clients.log");
  const backupRoot = `/mnt/storage/backups/aic-strapi-contract-${randomUUID()}`;
  const password = "contract-test-password-must-not-appear";
  const aicEnv = join(sandbox, ".env");

  try {
    writeFileSync(
      aicEnv,
      `DB_HOST=192.168.1.106\nDB_PORT=5432\nDB_NAME=aic_contract\nDB_USER=aic_contract_user\nDB_PASSWORD=${password}\n`,
      { mode: 0o600 },
    );
    for (const client of ["pg_dump", "pg_restore"]) {
      writeFileSync(
        join(sandbox, client),
        `#!/usr/bin/env bash
set -euo pipefail
printf '%s %s\\n' "$(basename "$0")" "$*" >> "\${MOCK_CLIENT_LOG:?}"
echo "${client} (PostgreSQL) 16.14"
`,
        { mode: 0o700 },
      );
    }

    assert.notEqual(statSync(backupScript).mode & 0o111, 0, "backup script must be executable");

    const result = spawnSync(databaseWrapper, [backupScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "test",
        MOCK_CLIENT_LOG: clientLog,
        STRAPI_AIC_ENV_FILE: aicEnv,
        STRAPI_DATABASE_ENV_TEST_MODE: "1",
        STRAPI_POSTGRES_CLIENT_ROOT: sandbox,
        STRAPI_NATIVE_CLIENT_TEST_MODE: "1",
        STRAPI_BACKUP_DRY_RUN: "1",
        STRAPI_BACKUP_ROOT: backupRoot,
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /pg_dump \(PostgreSQL\) 16/);
    assert.match(result.stdout, /pg_restore \(PostgreSQL\) 16/);
    assert.match(result.stdout, /no backup files were created/);

    const calls = readFileSync(clientLog, "utf8");
    assert.match(calls, /pg_dump --version/);
    assert.match(calls, /pg_restore --version/);
    assert.doesNotMatch(calls, new RegExp(password));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("Strapi backup dump contract keeps credentials out of argv", () => {
  const source = readFileSync(backupScript, "utf8");

  assert.match(source, /canonical_client_root="\/usr\/lib\/postgresql\/16\/bin"/);
  assert.match(source, /PGCONNECT_TIMEOUT=5 PGPASSWORD="\$\{DATABASE_PASSWORD\}" "\$\{pg_dump_bin\}"/);
  assert.match(source, /--host "\$\{DATABASE_HOST\}"/);
  assert.match(source, /--dbname "\$\{DATABASE_NAME\}"/);
  assert.match(source, /--schema "\$\{DATABASE_SCHEMA\}"/);
  assert.match(source, /require-canonical-db-context\.sh/);
  assert.match(source, /"\$\{pg_restore_bin\}" --list "\$\{partial_dir\}\/database\.dump"/);
  assert.match(source, /"\$\{pg_restore_bin\}" --exit-on-error --file=\/dev\/null/);
  assert.match(source, /database_schema=%s/);
  assert.match(source, /database_port=%s/);
  assert.match(source, /sha256sum database\.dump database\.contents media\.contents manifest\.env/);
  assert.match(source, /Required Strapi media root is missing/);
  assert.doesNotMatch(source, /Media root was absent at backup time/);
  assert.doesNotMatch(source, /docker|--network|--mount/);
  assert.doesNotMatch(source, /CREATE DATABASE|DROP DATABASE|pg_restore\s+--dbname/);
});

test("Strapi backup rejects direct invocation even with plausible database variables", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aic-strapi-backup-direct-"));
  const aicEnv = join(sandbox, ".env");
  try {
    writeFileSync(
      aicEnv,
      "DB_HOST=192.168.1.106\nDB_PORT=5432\nDB_NAME=aic_contract\nDB_USER=aic_contract_user\nDB_PASSWORD=test-only\n",
      { mode: 0o600 },
    );
    const result = spawnSync(backupScript, [], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_CLIENT: "postgres",
        DATABASE_HOST: "192.168.1.106",
        DATABASE_PORT: "5432",
        DATABASE_NAME: "aic_contract",
        DATABASE_USERNAME: "aic_contract_user",
        DATABASE_PASSWORD: "test-only",
        DATABASE_SCHEMA: "aic_strapi",
        STRAPI_AIC_ENV_FILE: aicEnv,
        STRAPI_DATABASE_ENV_TEST_MODE: "1",
        STRAPI_POSTGRES_CLIENT_ROOT: sandbox,
        STRAPI_NATIVE_CLIENT_TEST_MODE: "1",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be entered through with-aic-db-env\.sh/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
