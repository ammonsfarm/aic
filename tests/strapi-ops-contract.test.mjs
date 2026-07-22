import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const opsRoot = join(repoRoot, "ops", "strapi");

function source(relativePath) {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

for (const name of [
  "backup-strapi.sh",
  "contract-start-test.sh",
  "install-strapi-service.sh",
  "prepare-strapi-storage.sh",
  "provision-strapi.sh",
  "restore-drill.sh",
  "sync-aic-strapi-env.sh",
]) {
  test(`${name} is executable and has valid shell syntax`, () => {
    const path = join(opsRoot, name);
    assert.notEqual(statSync(path).mode & 0o111, 0);
    const result = spawnSync("bash", ["-n", path], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  });
}

test("provisioning is pinned to an isolated database and protected secret file", () => {
  const script = source("ops/strapi/provision-strapi.sh");
  assert.match(script, /env_file="\$\{STRAPI_ENV_FILE:-\/etc\/aic\/strapi\.env\}"/);
  assert.match(script, /secrets_backup="\$\{STRAPI_SECRETS_BACKUP:-\/mnt\/storage\/backups\/aic-strapi-secrets\}"/);
  assert.match(script, /database_name="aic_strapi"/);
  assert.match(script, /database_role="aic_strapi"/);
  assert.match(script, /root:root:600/);
  assert.match(script, /NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION/);
  assert.match(script, /REVOKE ALL ON DATABASE/);
  assert.match(script, /install -d -o root -g root -m 0700 "\$\{secrets_backup\}"/);
  assert.match(script, /install -o root -g root -m 0600 "\$\{env_file\}" "\$\{secrets_backup\}\/strapi\.env"/);
  assert.match(script, /sha256sum --check SHA256SUMS/);
  assert.doesNotMatch(script, /DATABASE_PASSWORD[^\n]+docker exec/);
});

test("managed Strapi token is scoped, runtime-only, and replaces broad defaults", () => {
  const bootstrap = source("services/jimwood-cms/src/index.ts");
  const unit = source("ops/strapi/systemd/aic-strapi.service");
  assert.match(bootstrap, /type: 'custom'/);
  assert.match(bootstrap, /managedPermissionPrefixes/);
  assert.match(bootstrap, /plugin::upload\.content-api\./);
  assert.match(bootstrap, /\['Full Access', 'Read Only'\]/);
  assert.match(bootstrap, /tokenService\.getByName\(broadTokenName\)/);
  assert.match(bootstrap, /outputPath !== managedTokenPath/);
  assert.match(unit, /Environment=AIC_API_TOKEN_OUTPUT_FILE=\/run\/aic-strapi\/aic-api-token/);
  assert.match(unit, /RuntimeDirectory=aic-strapi/);
  assert.match(unit, /RuntimeDirectoryMode=0700/);
  assert.match(unit, /Environment=HOST=127\.0\.0\.1/);
});

test("restore drill verifies checksums and cannot target the live database", () => {
  const script = source("ops/strapi/restore-drill.sh");
  assert.match(script, /sha256sum --check SHA256SUMS/);
  assert.match(script, /\^aic_strapi_restore_/);
  assert.match(script, /--exit-on-error/);
  assert.match(script, /DROP DATABASE IF EXISTS/);
  assert.match(script, /aic-strapi-restore-drill\./);
  assert.doesNotMatch(script, /--clean/);
  assert.doesNotMatch(script, /--dbname "\$\{DATABASE_NAME\}"/);
});

test("deploy builds Strapi before installing it and keeps restore drill explicit", () => {
  const deploy = source("scripts/deploy-farm-web.sh");
  const buildIndex = deploy.indexOf("npm --prefix services/jimwood-cms run build");
  const installIndex = deploy.indexOf("sudo bash ops/strapi/install-strapi-service.sh");
  assert.ok(buildIndex >= 0 && installIndex > buildIndex);
  assert.match(deploy, /RUN_STRAPI_BACKUP_DRILL="\$\{RUN_STRAPI_BACKUP_DRILL:-0\}"/);
  assert.match(deploy, /sudo bash ops\/strapi\/restore-drill\.sh/);
});
