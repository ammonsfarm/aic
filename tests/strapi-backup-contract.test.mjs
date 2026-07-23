import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const backupScript = join(repoRoot, "ops", "strapi", "backup-strapi.sh");
const verifyScript = join(repoRoot, "ops", "strapi", "verify-strapi-backup.sh");
const databaseWrapper = join(repoRoot, "ops", "strapi", "with-aic-db-env.sh");
const snapshotId = "00000003-0000001B-1";
const publicTables = [
  "public.public_subscriptions",
  "public.public_subscription_attempts",
  "public.public_subscription_events",
  "public.public_subscription_provider_outbox",
  "public.public_subscription_provider_webhook_events",
  "public.public_contact_messages",
  "public.public_contact_attempts",
  "public.public_contact_message_events",
  "public.pastorwood_public_projection",
  "public.pastorwood_public_projection_identities",
  "public.pastorwood_public_projection_media",
];
const publicSequences = [
  "public.public_subscriptions_id_seq",
  "public.public_subscription_attempts_id_seq",
  "public.public_subscription_events_id_seq",
  "public.public_contact_messages_id_seq",
  "public.public_contact_attempts_id_seq",
  "public.public_contact_message_events_id_seq",
];

function writeStubClients(sandbox) {
  const clientLog = join(sandbox, "clients.log");
  const sessionOpen = join(sandbox, "snapshot-session-open");
  const rollbackSeen = join(sandbox, "rollback-seen");
  writeFileSync(clientLog, "", { mode: 0o600 });
  writeFileSync(
    join(sandbox, "psql"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  echo "psql (PostgreSQL) 16.14"
  exit 0
fi
printf 'psql-start' >> "\${MOCK_CLIENT_LOG:?}"
printf ' %q' "$@" >> "\${MOCK_CLIENT_LOG:?}"
printf '\n' >> "\${MOCK_CLIENT_LOG:?}"
printf 'open\n' > "\${MOCK_SESSION_OPEN:?}"
trap 'rm -f -- "\${MOCK_SESSION_OPEN}"; printf "psql-exit\\n" >> "\${MOCK_CLIENT_LOG}"' EXIT
while IFS= read -r statement; do
  printf 'sql:%s\n' "\${statement}" >> "\${MOCK_CLIENT_LOG:?}"
  case "\${statement}" in
    *pg_export_snapshot*) printf 'AIC_SNAPSHOT:%s\n' "\${MOCK_SNAPSHOT_ID:?}" ;;
    ROLLBACK*) printf 'rollback\n' > "\${MOCK_ROLLBACK_SEEN:?}" ;;
    '\\q') exit 0 ;;
  esac
done
`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(sandbox, "pg_dump"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  echo "pg_dump (PostgreSQL) 16.14"
  exit 0
fi
output=""
kind=""
snapshot=""
printf 'pg_dump' >> "\${MOCK_CLIENT_LOG:?}"
for argument in "$@"; do
  printf ' %q' "\${argument}" >> "\${MOCK_CLIENT_LOG:?}"
  case "\${argument}" in
    --file=*) output="\${argument#--file=}" ;;
    --snapshot=*) snapshot="\${argument#--snapshot=}" ;;
    --schema=aic_strapi) kind="schema" ;;
  esac
done
printf '\n' >> "\${MOCK_CLIENT_LOG:?}"
if [[ "\${output}" == */public-operational.dump ]]; then kind="public"; fi
[[ -f "\${MOCK_SESSION_OPEN:?}" ]]
[[ "\${snapshot}" == "\${MOCK_SNAPSHOT_ID:?}" ]]
printf 'dump-%s-start\n' "\${kind}" >> "\${MOCK_CLIENT_LOG:?}"
if [[ "\${kind}" == "public" && "\${MOCK_FAIL_PUBLIC_DUMP:-0}" == "1" ]]; then
  printf 'dump-public-failed\n' >> "\${MOCK_CLIENT_LOG:?}"
  exit 41
fi
printf '%s\n' "\${kind}" > "\${output:?}"
printf 'dump-%s-done\n' "\${kind}" >> "\${MOCK_CLIENT_LOG:?}"
`,
    { mode: 0o700 },
  );

  const schemaToc = [
    "1; 2615 1 SCHEMA - aic_strapi owner",
    "2; 1259 2 TABLE aic_strapi pages owner",
    "3; 0 2 TABLE DATA aic_strapi pages owner",
  ];
  const publicToc = [];
  let tocId = 10;
  for (const qualifiedName of publicTables) {
    const name = qualifiedName.slice("public.".length);
    publicToc.push(`${tocId++}; 1259 ${tocId} TABLE public ${name} owner`);
    publicToc.push(`${tocId++}; 0 ${tocId} TABLE DATA public ${name} owner`);
  }
  for (const qualifiedName of publicSequences) {
    const name = qualifiedName.slice("public.".length);
    publicToc.push(`${tocId++}; 1259 ${tocId} SEQUENCE public ${name} owner`);
    publicToc.push(`${tocId++}; 0 ${tocId} SEQUENCE SET public ${name} owner`);
  }
  writeFileSync(
    join(sandbox, "pg_restore"),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  echo "pg_restore (PostgreSQL) 16.14"
  exit 0
fi
printf 'pg_restore' >> "\${MOCK_CLIENT_LOG:?}"
printf ' %q' "$@" >> "\${MOCK_CLIENT_LOG:?}"
printf '\n' >> "\${MOCK_CLIENT_LOG:?}"
if [[ "\${1:-}" == "--list" ]]; then
  case "\${2:-}" in
    */aic-strapi-schema.dump) printf '%s\n' ${schemaToc.map((line) => JSON.stringify(line)).join(" ")} ;;
    */public-operational.dump) printf '%s\n' ${publicToc.map((line) => JSON.stringify(line)).join(" ")} ;;
    *) exit 42 ;;
  esac
  exit 0
fi
for argument in "$@"; do
  [[ "\${argument}" != --dbname* && "\${argument}" != -d ]]
done
[[ "\${1:-}" == "--exit-on-error" ]]
[[ "\${2:-}" == "--file=/dev/null" ]]
[[ -f "\${3:-}" ]]
`,
    { mode: 0o700 },
  );
  return { clientLog, sessionOpen, rollbackSeen };
}

function testEnvironment(sandbox, password) {
  const aicEnv = join(sandbox, ".env");
  const backupRoot = join(sandbox, "backups");
  const mediaRoot = join(sandbox, "media");
  mkdirSync(mediaRoot, { recursive: true, mode: 0o700 });
  writeFileSync(join(mediaRoot, "example.txt"), "media\n", { mode: 0o600 });
  writeFileSync(
    aicEnv,
    `DB_HOST=192.168.1.106\nDB_PORT=5432\nDB_NAME=aic_contract\nDB_USER=aic_contract_user\nDB_PASSWORD=${password}\n`,
    { mode: 0o600 },
  );
  const stubs = writeStubClients(sandbox);
  return {
    aicEnv,
    backupRoot,
    mediaRoot,
    stubs,
    environment: {
      ...process.env,
      NODE_ENV: "test",
      MOCK_CLIENT_LOG: stubs.clientLog,
      MOCK_SESSION_OPEN: stubs.sessionOpen,
      MOCK_ROLLBACK_SEEN: stubs.rollbackSeen,
      MOCK_SNAPSHOT_ID: snapshotId,
      STRAPI_AIC_ENV_FILE: aicEnv,
      STRAPI_DATABASE_ENV_TEST_MODE: "1",
      STRAPI_POSTGRES_CLIENT_ROOT: sandbox,
      STRAPI_NATIVE_CLIENT_TEST_MODE: "1",
      STRAPI_BACKUP_TEST_ROOT: sandbox,
      STRAPI_BACKUP_ROOT: backupRoot,
      STRAPI_MEDIA_ROOT: mediaRoot,
    },
  };
}

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
    for (const client of ["psql", "pg_dump", "pg_restore"]) {
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
    assert.match(result.stdout, /psql \(PostgreSQL\) 16/);
    assert.match(result.stdout, /pg_dump \(PostgreSQL\) 16/);
    assert.match(result.stdout, /pg_restore \(PostgreSQL\) 16/);
    assert.match(result.stdout, /no backup files were created/);

    const calls = readFileSync(clientLog, "utf8");
    assert.match(calls, /psql --version/);
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
  assert.match(source, /PGPASSWORD="\$\{DATABASE_PASSWORD\}"/);
  assert.match(source, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(source, /pg_export_snapshot/);
  assert.match(source, /--snapshot="\$\{snapshot_id\}"/);
  assert.match(source, /--host "\$\{DATABASE_HOST\}"/);
  assert.match(source, /--dbname "\$\{DATABASE_NAME\}"/);
  assert.match(source, /--schema="\$\{DATABASE_SCHEMA\}"/);
  assert.match(source, /--table="\$\{relation\}"/);
  assert.match(source, /require-canonical-db-context\.sh/);
  assert.match(source, /"\$\{pg_restore_bin\}" --list "\$\{partial_dir\}\/aic-strapi-schema\.dump"/);
  assert.match(source, /"\$\{pg_restore_bin\}" --list "\$\{partial_dir\}\/public-operational\.dump"/);
  assert.match(source, /"\$\{pg_restore_bin\}" --exit-on-error --file=\/dev\/null/);
  assert.match(source, /database_schema=%s/);
  assert.match(source, /snapshot_id=%s/);
  assert.match(source, /database_port=%s/);
  assert.match(source, /sha256sum[\s\S]*aic-strapi-schema\.dump[\s\S]*public-operational\.dump/);
  assert.match(source, /Required Strapi media root is missing/);
  assert.doesNotMatch(source, /Media root was absent at backup time/);
  assert.doesNotMatch(source, /docker|--network|--mount/);
  assert.doesNotMatch(source, /CREATE DATABASE|DROP DATABASE|pg_restore\s+--dbname/);
});

test("production backup rejects every media or backup path override before client access", () => {
  for (const [name, value] of [
    ["STRAPI_BACKUP_ROOT", "/mnt/storage/backups/alternate"],
    ["STRAPI_MEDIA_ROOT", "/mnt/storage/pastorwood-media/alternate"],
  ]) {
    const result = spawnSync(backupScript, [], {
      encoding: "utf8",
      env: { ...process.env, [name]: value },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exact AIC backup and Strapi media roots/);
  }
});

test("one read-only exported snapshot feeds exactly the two approved archives", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aic-strapi-backup-test-"));
  const password = "shared-snapshot-password-must-not-appear";
  try {
    const setup = testEnvironment(sandbox, password);
    const result = spawnSync(databaseWrapper, [backupScript], {
      encoding: "utf8",
      env: setup.environment,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(statSync(setup.stubs.rollbackSeen).isFile(), true);
    assert.equal(readdirSync(setup.backupRoot).filter((name) => name.startsWith(".partial-")).length, 0);

    const backupNames = readdirSync(setup.backupRoot).filter((name) => /^20\d\d-\d\d-\d\dT\d{6}Z$/.test(name));
    assert.equal(backupNames.length, 1);
    const backupDirectory = join(setup.backupRoot, backupNames[0]);
    const dumpFiles = readdirSync(backupDirectory).filter((name) => name.endsWith(".dump")).sort();
    assert.deepEqual(dumpFiles, ["aic-strapi-schema.dump", "public-operational.dump"]);

    const clientLog = readFileSync(setup.stubs.clientLog, "utf8");
    assert.match(clientLog, /sql:BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
    assert.equal((clientLog.match(/pg_export_snapshot/g) ?? []).length, 1);
    assert.match(clientLog, /sql:ROLLBACK;/);
    assert.doesNotMatch(clientLog, new RegExp(password));
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(password));

    const dumpCalls = clientLog.split("\n").filter((line) => line.startsWith("pg_dump "));
    assert.equal(dumpCalls.length, 2);
    const schemaCall = dumpCalls.find((line) => line.includes("aic-strapi-schema.dump"));
    const publicCall = dumpCalls.find((line) => line.includes("public-operational.dump"));
    assert.ok(schemaCall);
    assert.ok(publicCall);
    assert.match(schemaCall, new RegExp(` --snapshot=${snapshotId}(?: |$)`));
    assert.match(publicCall, new RegExp(` --snapshot=${snapshotId}(?: |$)`));
    assert.match(schemaCall, / --schema=aic_strapi(?: |$)/);
    assert.doesNotMatch(schemaCall, / --table=/);
    assert.doesNotMatch(publicCall, / --schema=/);
    const publicFlags = publicCall.split(" ").filter((argument) => argument.startsWith("--table="));
    assert.deepEqual(publicFlags, [...publicTables, ...publicSequences].map((name) => `--table=${name}`));

    const openIndex = clientLog.indexOf("psql-start");
    const schemaDoneIndex = clientLog.indexOf("dump-schema-done");
    const publicDoneIndex = clientLog.indexOf("dump-public-done");
    const rollbackIndex = clientLog.indexOf("sql:ROLLBACK;");
    assert.ok(openIndex >= 0 && schemaDoneIndex > openIndex && publicDoneIndex > schemaDoneIndex && rollbackIndex > publicDoneIndex);

    const manifest = readFileSync(join(backupDirectory, "manifest.env"), "utf8");
    assert.match(manifest, /^database_host=192\.168\.1\.106$/m);
    assert.match(manifest, /^database_port=5432$/m);
    assert.match(manifest, /^database_name=aic_contract$/m);
    assert.match(manifest, /^database_schema=aic_strapi$/m);
    assert.match(manifest, new RegExp(`^snapshot_id=${snapshotId}$`, "m"));
    assert.match(manifest, new RegExp(`^public_tables=${publicTables.join(",")}$`, "m"));
    assert.match(manifest, new RegExp(`^public_sequences=${publicSequences.join(",")}$`, "m"));

    const verify = spawnSync(verifyScript, [backupDirectory], {
      encoding: "utf8",
      env: setup.environment,
    });
    assert.equal(verify.status, 0, verify.stderr || verify.stdout);
    assert.match(verify.stdout, /offline without restoring a database/);
    const completeLog = readFileSync(setup.stubs.clientLog, "utf8");
    for (const line of completeLog.split("\n").filter((entry) => entry.startsWith("pg_restore "))) {
      assert.doesNotMatch(line, /(?:^| )--dbname(?:=| )|(?:^| )-d(?: |$)/);
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("a failed second dump rolls back the snapshot and removes every partial artifact", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aic-strapi-backup-test-"));
  const password = "failed-backup-password-must-not-appear";
  try {
    const setup = testEnvironment(sandbox, password);
    const result = spawnSync(databaseWrapper, [backupScript], {
      encoding: "utf8",
      env: { ...setup.environment, MOCK_FAIL_PUBLIC_DUMP: "1" },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /public operational archive could not be created/);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(password));
    assert.equal(statSync(setup.stubs.rollbackSeen).isFile(), true);
    const remaining = readdirSync(setup.backupRoot);
    assert.equal(remaining.some((name) => name.startsWith(".partial-") || /^20\d\d-/.test(name)), false);
    const clientLog = readFileSync(setup.stubs.clientLog, "utf8");
    assert.match(clientLog, /dump-public-failed/);
    assert.match(clientLog, /sql:ROLLBACK;/);
    assert.match(clientLog, /psql-exit/);
    assert.doesNotMatch(clientLog, new RegExp(password));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("offline TOC validation rejects any public relation outside the exact inventory", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aic-strapi-toc-contract-"));
  const listing = join(sandbox, "public.contents");
  const validator = join(repoRoot, "ops", "strapi", "validate-backup-toc.py");
  const lines = [];
  let identifier = 1;
  for (const qualifiedName of publicTables) {
    const name = qualifiedName.slice("public.".length);
    lines.push(`${identifier++}; 1259 ${identifier} TABLE public ${name} owner`);
    lines.push(`${identifier++}; 0 ${identifier} TABLE DATA public ${name} owner`);
  }
  for (const qualifiedName of publicSequences) {
    const name = qualifiedName.slice("public.".length);
    lines.push(`${identifier++}; 1259 ${identifier} SEQUENCE public ${name} owner`);
    lines.push(`${identifier++}; 0 ${identifier} SEQUENCE SET public ${name} owner`);
  }
  lines.push(`${identifier++}; 1259 ${identifier} TABLE public unexpected_table owner`);
  try {
    writeFileSync(listing, `${lines.join("\n")}\n`, { mode: 0o600 });
    const result = spawnSync("python3", [validator, "public", listing], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unexpected=public\.unexpected_table/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
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
