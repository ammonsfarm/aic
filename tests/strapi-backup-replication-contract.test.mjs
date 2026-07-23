import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const replicationScript = join(repoRoot, "ops", "strapi", "replicate-verified-backups.sh");
const validator = join(repoRoot, "ops", "strapi", "validate-rclone-crypt-config.py");
const payloadFiles = [
  "SHA256SUMS",
  "aic-strapi-schema.contents",
  "aic-strapi-schema.dump",
  "manifest.env",
  "media.contents",
  "media.tar.gz",
  "public-operational.contents",
  "public-operational.dump",
];

function privateWrite(path, content) {
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function makeSandbox({ verifierFails = false, backingType = "onedrive" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "aic-strapi-replication-test-"));
  const backupRoot = join(root, "backups");
  const opsRoot = join(root, "ops");
  const remoteRoot = join(root, "remote");
  const log = join(root, "rclone.log");
  const verifyLog = join(root, "verify.log");
  const rclone = join(root, "rclone");
  const config = join(root, "replication.env");
  const rcloneConfig = join(root, "rclone.conf");
  const recovery = join(root, "recovery.confirmation");
  mkdirSync(backupRoot, { recursive: true });
  mkdirSync(opsRoot, { recursive: true });
  mkdirSync(remoteRoot, { recursive: true });
  privateWrite(log, "");
  privateWrite(verifyLog, "");

  copyFileSync(validator, join(opsRoot, "validate-rclone-crypt-config.py"));
  chmodSync(join(opsRoot, "validate-rclone-crypt-config.py"), 0o755);
  writeFileSync(
    join(opsRoot, "verify-strapi-backup.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" >> "${verifyLog}"
${verifierFails ? "exit 42" : "test -d \"$1\""}
`,
    { mode: 0o755 },
  );
  chmodSync(join(opsRoot, "verify-strapi-backup.sh"), 0o755);

  writeFileSync(
    rclone,
    `#!/usr/bin/env bash
set -euo pipefail
command_name="\${1:?}"
shift
printf '%s\n' "\${command_name}" >> "${log}"
map_path() {
  case "$1" in
    *:*) printf '%s/%s' "${remoteRoot}" "\${1#*:}" ;;
    *) printf '%s' "$1" ;;
  esac
}
case "\${command_name}" in
  version)
    echo 'rclone v1.60.1-DEV'
    ;;
  mkdir)
    mkdir -p -- "$(map_path "$1")"
    ;;
  lsf)
    source_path="$(map_path "$1")"
    test -d "\${source_path}"
    files_only=0
    dirs_only=0
    recursive=0
    for argument in "$@"; do
      case "\${argument}" in
        --files-only) files_only=1 ;;
        --dirs-only) dirs_only=1 ;;
        --recursive) recursive=1 ;;
      esac
    done
    if [[ "\${dirs_only}" == 1 ]]; then
      find "\${source_path}" -mindepth 1 -maxdepth 1 -type d -printf '%f/\\n' | sort
    elif [[ "\${files_only}" == 1 && "\${recursive}" == 1 ]]; then
      find "\${source_path}" -mindepth 1 -type f -printf '%P\\n' | sort
    elif [[ "\${files_only}" == 1 ]]; then
      find "\${source_path}" -mindepth 1 -maxdepth 1 -type f -printf '%f\\n' | sort
    else
      find "\${source_path}" -mindepth 1 -maxdepth 1 -printf '%f\\n' | sort
    fi
    ;;
  copy)
    source_path="$(map_path "$1")"
    destination_path="$(map_path "$2")"
    mkdir -p -- "\${destination_path}"
    cp -a -- "\${source_path}/." "\${destination_path}/"
    ;;
  cryptcheck)
    diff -qr -- "$(map_path "$1")" "$(map_path "$2")" >/dev/null
    ;;
  moveto)
    source_path="$(map_path "$1")"
    destination_path="$(map_path "$2")"
    mkdir -p -- "$(dirname -- "\${destination_path}")"
    mv -- "\${source_path}" "\${destination_path}"
    ;;
  copyto)
    source_path="$(map_path "$1")"
    destination_path="$(map_path "$2")"
    mkdir -p -- "$(dirname -- "\${destination_path}")"
    cp -- "\${source_path}" "\${destination_path}"
    ;;
  purge)
    rm -rf -- "$(map_path "$1")"
    ;;
  *)
    echo "unexpected stub rclone command" >&2
    exit 91
    ;;
esac
`,
    { mode: 0o755 },
  );
  chmodSync(rclone, 0o755);

  privateWrite(
    config,
    [
      "AIC_STRAPI_BACKUP_REPLICATION_ENABLED=1",
      `RCLONE_CONFIG_PATH=${rcloneConfig}`,
      "RCLONE_CRYPT_REMOTE=aic-strapi-crypt",
      "OFF_HOST_REMOTE_CONFIRMED=YES",
      "REMOTE_RETENTION_GENERATIONS=2",
      "",
    ].join("\n"),
  );
  privateWrite(
    recovery,
    [
      "AIC_STRAPI_CRYPT_RECOVERY_MATERIAL_STORED_OFF_HOST=YES",
      `AIC_STRAPI_CRYPT_RECOVERY_KIT_SHA256=${"a".repeat(64)}`,
      "",
    ].join("\n"),
  );
  privateWrite(
    rcloneConfig,
    [
      "[offhost]",
      `type = ${backingType}`,
      "token = test-only-obscured-provider-token",
      "",
      "[aic-strapi-crypt]",
      "type = crypt",
      "remote = offhost:encrypted-aic-strapi",
      "password = test-only-obscured-password",
      "password2 = test-only-obscured-salt",
      "filename_encryption = standard",
      "directory_name_encryption = true",
      "",
    ].join("\n"),
  );

  const environment = {
    ...process.env,
    NODE_ENV: "test",
    AIC_STRAPI_REPLICATION_TEST_MODE: "1",
    AIC_STRAPI_REPLICATION_TEST_ROOT: root,
    AIC_STRAPI_REPLICATION_BACKUP_ROOT: backupRoot,
    AIC_STRAPI_REPLICATION_OPS_ROOT: opsRoot,
    AIC_STRAPI_REPLICATION_CONFIG: config,
    AIC_STRAPI_REPLICATION_RECOVERY_CONFIRMATION: recovery,
    AIC_STRAPI_REPLICATION_RCLONE_BIN: rclone,
    AIC_STRAPI_REPLICATION_LOCK_FILE: join(root, "replication.lock"),
  };
  return { root, backupRoot, remoteRoot, log, verifyLog, environment };
}

function addBackup(setup, stamp = "2026-07-23T071500Z") {
  const backup = join(setup.backupRoot, stamp);
  mkdirSync(backup, { recursive: true });
  for (const name of payloadFiles) {
    privateWrite(join(backup, name), `${name}-test-payload\n`);
  }
  return { backup, stamp };
}

test("off-host replication is code-only, crypt-only, and disabled by default", () => {
  const source = readFileSync(replicationScript, "utf8");
  const example = readFileSync(
    join(repoRoot, "ops", "strapi", "strapi-backup-replication.env.example"),
    "utf8",
  );
  const service = readFileSync(
    join(repoRoot, "ops", "strapi", "systemd", "aic-strapi-backup-replication.service"),
    "utf8",
  );
  const installer = readFileSync(join(repoRoot, "ops", "strapi", "install-strapi-service.sh"), "utf8");

  assert.match(example, /^AIC_STRAPI_BACKUP_REPLICATION_ENABLED=0$/m);
  assert.match(example, /^OFF_HOST_REMOTE_CONFIRMED=NO$/m);
  assert.match(source, /verify-strapi-backup\.sh/);
  assert.match(source, /cryptcheck/);
  assert.match(source, /staging/);
  assert.match(source, /\.complete/);
  assert.match(source, /REMOTE_RETENTION_GENERATIONS must be between 2 and 365/);
  assert.doesNotMatch(source, /pg_dump|pg_restore|\bpsql\b|with-aic-db-env|DATABASE_HOST|DATABASE_URL/);
  assert.doesNotMatch(installer, /enable(?: --now)? aic-strapi-backup-replication\.timer/);
  assert.match(service, /ProtectSystem=strict/);
  assert.match(service, /ReadOnlyPaths=\/mnt\/storage\/backups\/aic-strapi/);
  assert.match(service, /UnsetEnvironment=.*RCLONE_CONFIG_PASS/);
});

test("config-only validation performs no network or database operation", () => {
  const setup = makeSandbox();
  try {
    const result = spawnSync("bash", [replicationScript, "--validate-config-only"], {
      encoding: "utf8",
      env: setup.environment,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /without network or database access/);
    assert.equal(readFileSync(setup.log, "utf8"), "version\n");
    assert.equal(readFileSync(setup.verifyLog, "utf8"), "");
  } finally {
    rmSync(setup.root, { recursive: true, force: true });
  }
});

test("every local set is offline-verified before staged encrypted replication", () => {
  const setup = makeSandbox();
  const { backup, stamp } = addBackup(setup);
  try {
    const first = spawnSync("bash", [replicationScript], { encoding: "utf8", env: setup.environment });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.match(first.stdout, /new verified generations: 1/);
    assert.equal(readFileSync(setup.verifyLog, "utf8"), `${backup}\n`);

    const finalDirectory = join(
      setup.remoteRoot,
      "aic-strapi",
      "verified-v1",
      "sets",
      stamp,
    );
    assert.deepEqual(readdirSync(finalDirectory).sort(), [".complete", ...payloadFiles].sort());
    assert.match(readFileSync(join(finalDirectory, ".complete"), "utf8"), new RegExp(`backup_stamp=${stamp}`));
    const firstCommands = readFileSync(setup.log, "utf8");
    assert.match(firstCommands, /\ncopy\n/);
    assert.equal((firstCommands.match(/^cryptcheck$/gm) ?? []).length, 2);
    assert.match(firstCommands, /^moveto$/m);
    assert.doesNotMatch(firstCommands, /password|salt|token/);

    privateWrite(setup.log, "");
    const second = spawnSync("bash", [replicationScript], { encoding: "utf8", env: setup.environment });
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.match(second.stdout, /new verified generations: 0/);
    const secondCommands = readFileSync(setup.log, "utf8");
    assert.doesNotMatch(secondCommands, /^copy$/m);
    assert.doesNotMatch(secondCommands, /^cryptcheck$/m);
    assert.doesNotMatch(secondCommands, /^moveto$/m);
  } finally {
    rmSync(setup.root, { recursive: true, force: true });
  }
});

test("offline verification failure prevents every remote operation", () => {
  const setup = makeSandbox({ verifierFails: true });
  addBackup(setup);
  try {
    const result = spawnSync("bash", [replicationScript], { encoding: "utf8", env: setup.environment });
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(setup.log, "utf8"), "version\n");
    assert.equal(readdirSync(setup.remoteRoot).length, 0);
  } finally {
    rmSync(setup.root, { recursive: true, force: true });
  }
});

test("retention removes only an oldest generation with a valid managed marker", () => {
  const setup = makeSandbox();
  const stamps = [
    "2026-07-21T071500Z",
    "2026-07-22T071500Z",
    "2026-07-23T071500Z",
  ];
  for (const stamp of stamps) addBackup(setup, stamp);
  try {
    const result = spawnSync("bash", [replicationScript], { encoding: "utf8", env: setup.environment });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const setRoot = join(setup.remoteRoot, "aic-strapi", "verified-v1", "sets");
    assert.deepEqual(readdirSync(setRoot).sort(), stamps.slice(1));
    assert.equal((readFileSync(setup.log, "utf8").match(/^purge$/gm) ?? []).length, 1);
  } finally {
    rmSync(setup.root, { recursive: true, force: true });
  }
});

test("crypt validator rejects a local backing remote", () => {
  const setup = makeSandbox({ backingType: "local" });
  try {
    const result = spawnSync("bash", [replicationScript, "--validate-config-only"], {
      encoding: "utf8",
      env: setup.environment,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /direct off-host-capable backing provider/);
    assert.equal(readFileSync(setup.log, "utf8"), "version\n");
  } finally {
    rmSync(setup.root, { recursive: true, force: true });
  }
});
