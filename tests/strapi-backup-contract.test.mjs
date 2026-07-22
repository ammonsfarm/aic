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

test("Strapi backup dry run uses the pinned local Docker client without side effects", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aic-strapi-backup-contract-"));
  const dockerLog = join(sandbox, "docker.log");
  const mockDocker = join(sandbox, "docker");
  const backupRoot = `/mnt/storage/backups/aic-strapi-contract-${randomUUID()}`;
  const password = "contract-test-password-must-not-appear";

  try {
    writeFileSync(
      mockDocker,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "\${MOCK_DOCKER_LOG:?}"
case "$*" in
  *"pg_dump --version"*) echo "pg_dump (PostgreSQL) 16" ;;
  *"pg_restore --version"*) echo "pg_restore (PostgreSQL) 16" ;;
esac
`,
      { mode: 0o700 },
    );

    assert.notEqual(statSync(backupScript).mode & 0o111, 0, "backup script must be executable");

    const result = spawnSync(backupScript, [], {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_HOST: "127.0.0.1",
        DATABASE_PORT: "5432",
        DATABASE_NAME: "aic_strapi_contract",
        DATABASE_USERNAME: "aic_strapi_contract",
        DATABASE_PASSWORD: password,
        MOCK_DOCKER_LOG: dockerLog,
        STRAPI_BACKUP_DOCKER_BIN: mockDocker,
        STRAPI_BACKUP_DRY_RUN: "1",
        STRAPI_BACKUP_ENV_FILE: join(sandbox, "missing.env"),
        STRAPI_BACKUP_ROOT: backupRoot,
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /pg_dump \(PostgreSQL\) 16/);
    assert.match(result.stdout, /pg_restore \(PostgreSQL\) 16/);
    assert.match(result.stdout, /no backup files were created/);

    const calls = readFileSync(dockerLog, "utf8");
    assert.match(calls, /image inspect postgres:16/);
    assert.match(calls, /--pull=never/);
    assert.match(calls, /--read-only/);
    assert.match(calls, /--cap-drop ALL/);
    assert.match(calls, /--network none postgres:16 pg_dump --version/);
    assert.match(calls, /--network none postgres:16 pg_restore --version/);
    assert.doesNotMatch(calls, new RegExp(password));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("Strapi backup dump contract keeps credentials out of argv", () => {
  const source = readFileSync(backupScript, "utf8");

  assert.match(source, /--network host/);
  assert.match(source, /--env PGPASSWORD/);
  assert.match(source, /--mount "type=bind,src=\$\{partial_dir\},dst=\/backup"/);
  assert.match(source, /pg_restore --list \/backup\/database\.dump/);
  assert.doesNotMatch(source, /--env PGPASSWORD=/);
  assert.doesNotMatch(source, /PGPASSWORD="\$\{DATABASE_PASSWORD\}"\s+pg_dump/);
});
