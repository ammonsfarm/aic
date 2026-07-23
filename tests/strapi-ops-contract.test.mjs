import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  "ensure-strapi-schema.sh",
  "install-strapi-ops.sh",
  "install-strapi-service.sh",
  "prepare-strapi-storage.sh",
  "provision-strapi.sh",
  "run-consistent-backup.sh",
  "sync-aic-strapi-env.sh",
  "verify-strapi-backup.sh",
  "with-aic-db-env.sh",
]) {
  test(`${name} is executable and has valid shell syntax`, () => {
    const path = join(opsRoot, name);
    assert.notEqual(statSync(path).mode & 0o111, 0);
    const result = spawnSync("bash", ["-n", path], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  });
}

test("runtime database mapping uses only the canonical AIC target and aic_strapi schema", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aic-strapi-db-env-"));
  const aicEnv = join(sandbox, ".env");
  const wrapper = join(opsRoot, "with-aic-db-env.sh");

  try {
    writeFileSync(
      aicEnv,
      [
        "DB_HOST=192.168.1.106",
        "DB_PORT=5432",
        "DB_NAME=aic_contract",
        "DB_USER=aic_contract_user",
        "DB_PASSWORD=contract-password",
        "NODE_ENV=development",
        "HOST=0.0.0.0",
        "APP_KEYS=wrong-app-keys",
        "CLERK_SECRET_KEY=must-not-export",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );

    const result = spawnSync(
      wrapper,
      [
        process.execPath,
        "-e",
        `console.log(JSON.stringify({
          client: process.env.DATABASE_CLIENT,
          host: process.env.DATABASE_HOST,
          port: process.env.DATABASE_PORT,
          name: process.env.DATABASE_NAME,
          user: process.env.DATABASE_USERNAME,
          passwordMatches: process.env.DATABASE_PASSWORD === 'contract-password',
          schema: process.env.DATABASE_SCHEMA,
          pgHost: process.env.PGHOST,
          pgPort: process.env.PGPORT,
          pgDatabase: process.env.PGDATABASE,
          pgUser: process.env.PGUSER,
          pgHostAddrPresent: Object.hasOwn(process.env, 'PGHOSTADDR'),
          pgServicePresent: Object.hasOwn(process.env, 'PGSERVICE'),
          pgServiceFilePresent: Object.hasOwn(process.env, 'PGSERVICEFILE'),
          pgPassFilePresent: Object.hasOwn(process.env, 'PGPASSFILE'),
          urlPresent: Object.hasOwn(process.env, 'DATABASE_URL'),
          unrelatedAicSecretPresent: Object.hasOwn(process.env, 'CLERK_SECRET_KEY'),
          nodeEnv: process.env.NODE_ENV,
          serviceHost: process.env.HOST,
          appKeysPreserved: process.env.APP_KEYS === 'right-app-keys',
        }))`,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          DB_HOST: "127.0.0.1",
          DATABASE_URL: "postgres://wrong-target.invalid/wrong",
          PGHOST: "wrong-pg-host.invalid",
          PGPORT: "9999",
          PGDATABASE: "wrong_pg_database",
          PGUSER: "wrong_pg_user",
          PGHOSTADDR: "127.0.0.1",
          PGSERVICE: "wrong-service",
          PGSERVICEFILE: "/tmp/wrong-pg-service",
          PGPASSFILE: "/tmp/wrong-pg-pass",
          NODE_ENV: "test",
          HOST: "127.0.0.1",
          APP_KEYS: "right-app-keys",
          STRAPI_AIC_ENV_FILE: aicEnv,
          STRAPI_DATABASE_ENV_TEST_MODE: "1",
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      client: "postgres",
      host: "192.168.1.106",
      port: "5432",
      name: "aic_contract",
      user: "aic_contract_user",
      passwordMatches: true,
      schema: "aic_strapi",
      pgHost: "192.168.1.106",
      pgPort: "5432",
      pgDatabase: "aic_contract",
      pgUser: "aic_contract_user",
      pgHostAddrPresent: false,
      pgServicePresent: false,
      pgServiceFilePresent: false,
      pgPassFilePresent: false,
      urlPresent: false,
      unrelatedAicSecretPresent: false,
      nodeEnv: "test",
      serviceHost: "127.0.0.1",
      appKeysPreserved: true,
    });
    assert.doesNotMatch(result.stderr, /contract-password/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("runtime database mapping rejects any host or port repointing", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aic-strapi-db-repoint-"));
  const aicEnv = join(sandbox, ".env");
  const wrapper = join(opsRoot, "with-aic-db-env.sh");

  try {
    for (const [host, port] of [
      ["127.0.0.1", "5432"],
      ["192.168.1.106", "5433"],
    ]) {
      writeFileSync(
        aicEnv,
        `DB_HOST=${host}\nDB_PORT=${port}\nDB_NAME=aic\nDB_USER=aic\nDB_PASSWORD=test-only\n`,
        { mode: 0o600 },
      );
      const result = spawnSync(wrapper, [process.execPath, "-e", "process.exit(0)"], {
        encoding: "utf8",
        env: {
          ...process.env,
          STRAPI_AIC_ENV_FILE: aicEnv,
          STRAPI_DATABASE_ENV_TEST_MODE: "1",
        },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /192\.168\.1\.106:5432/);
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("provisioning keeps application secrets separate and creates only the shared-database schema", () => {
  const provision = source("ops/strapi/provision-strapi.sh");
  const ensureSchema = source("ops/strapi/ensure-strapi-schema.sh");

  assert.match(provision, /env_file="\$\{STRAPI_ENV_FILE:-\/etc\/aic\/strapi\.env\}"/);
  assert.match(provision, /secrets_backup="\$\{STRAPI_SECRETS_BACKUP:-\/mnt\/storage\/backups\/aic-strapi-secrets\}"/);
  assert.match(provision, /grep -Eq '\^\(DB_\|DATABASE_\)'/);
  assert.match(provision, /with-aic-db-env\.sh/);
  assert.match(provision, /ensure-strapi-schema\.sh/);
  assert.match(provision, /install -o root -g root -m 0600 "\$\{env_file\}" "\$\{secrets_backup\}\/strapi\.env"/);
  assert.match(provision, /sha256sum --check SHA256SUMS/);
  assert.doesNotMatch(provision, /farm-postgres|CREATE DATABASE|CREATE ROLE|database_role=/);
  assert.doesNotMatch(provision, /printf 'DATABASE_|DATABASE_PASSWORD=.*random_hex/);
  assert.doesNotMatch(provision, /^"\$\{ops_root\}\/with-aic-db-env\.sh"/m);

  assert.match(ensureSchema, /DATABASE_SCHEMA.*aic_strapi/);
  assert.match(ensureSchema, /192\.168\.1\.106.*5432/);
  assert.match(ensureSchema, /CREATE SCHEMA IF NOT EXISTS \$\{DATABASE_SCHEMA\} AUTHORIZATION CURRENT_USER/);
  assert.match(ensureSchema, /REVOKE ALL ON SCHEMA \$\{DATABASE_SCHEMA\} FROM PUBLIC/);
  assert.match(ensureSchema, /actual_owner IS DISTINCT FROM current_user/);
  assert.match(ensureSchema, /--host "\$\{DATABASE_HOST\}"/);
  assert.match(ensureSchema, /--dbname "\$\{DATABASE_NAME\}"/);
  assert.doesNotMatch(ensureSchema, /CREATE DATABASE|CREATE ROLE|pg_restore|farm-postgres/);
});

test("root-executed operations are installed immutably outside the writable checkout", () => {
  const installer = source("ops/strapi/install-strapi-ops.sh");
  const deploy = source("scripts/deploy-farm-web.sh");
  assert.match(installer, /libexec_root="\$\{STRAPI_OPS_ROOT:-\/usr\/local\/libexec\/aic-strapi\}"/);
  assert.match(installer, /install -o root -g root -m 0755/);
  assert.match(installer, /install -o root -g root -m 0644/);
  assert.match(deploy, /\/usr\/local\/sbin\/aic-install-strapi-ops/);
  const targetCheckIndex = deploy.indexOf("/usr/local/libexec/aic-strapi/with-aic-db-env.sh /usr/bin/true");
  const migrationIndex = deploy.indexOf('echo "Applying database migrations..."');
  const inheritedUnsetIndex = deploy.indexOf("unset DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD");
  assert.ok(inheritedUnsetIndex >= 0 && targetCheckIndex > inheritedUnsetIndex);
  assert.match(deploy, /unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD/);
  assert.match(deploy, /unset PGPASSFILE PGSERVICE PGSERVICEFILE PGOPTIONS/);
  assert.ok(targetCheckIndex >= 0 && migrationIndex > targetCheckIndex);
  assert.match(deploy, /sudo \/usr\/local\/libexec\/aic-strapi\/provision-strapi\.sh/);
  assert.match(deploy, /sudo \/usr\/local\/libexec\/aic-strapi\/install-strapi-service\.sh/);
});

test("migration runner cannot inherit or accept a different database target", () => {
  const migrations = source("apply_postgres_migrations.py");
  const loader = source("scripts/aic_database_env.py");
  assert.match(migrations, /CANONICAL_AIC_ENV/);
  assert.match(migrations, /load_canonical_aic_env\(path, allow_test_path=allow_test_path\)/);
  assert.match(migrations, /database_dsn\(application_name="aic-postgres-migrations"\)/);
  assert.match(loader, /EXPECTED_DB_HOST = "192\.168\.1\.106"/);
  assert.match(loader, /EXPECTED_DB_PORT = "5432"/);
  assert.match(loader, /os\.environ\.pop\(key, None\)/);
  assert.match(loader, /missing = \[key for key in DATABASE_ENV_KEYS/);
  const dsnIndex = migrations.indexOf("connection_dsn = dsn()");
  const connectIndex = migrations.indexOf("psycopg.connect(connection_dsn");
  assert.ok(dsnIndex >= 0 && connectIndex > dsnIndex);
});

test("production Strapi rejects URL repointing and any schema other than aic_strapi", () => {
  const databaseConfig = source("services/jimwood-cms/config/database.ts");
  assert.match(databaseConfig, /Production Strapi does not accept DATABASE_URL/);
  assert.match(databaseConfig, /Production Strapi requires the existing AIC PostgreSQL target at 192\.168\.1\.106:5432/);
  assert.match(databaseConfig, /Production Strapi requires DATABASE_SCHEMA=aic_strapi/);
  assert.match(databaseConfig, /DATABASE_HOST/);
  assert.match(databaseConfig, /DATABASE_PASSWORD/);
});

test("all systemd writable paths exist before service namespace setup", () => {
  const provision = source("ops/strapi/provision-strapi.sh");
  const service = source("ops/strapi/systemd/aic-strapi.service");
  const schemaUnit = source("ops/strapi/systemd/aic-strapi-schema.service");
  const backupUnit = source("ops/strapi/systemd/aic-strapi-backup.service");

  for (const expected of [
    "/mnt/storage/aic/services/jimwood-cms/.tmp",
    "/mnt/storage/pastorwood-media/strapi",
    "/mnt/storage/backups/aic-strapi",
  ]) {
    assert.match(provision, new RegExp(expected.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
  }
  assert.match(service, /ProtectSystem=strict/);
  assert.match(service, /ReadOnlyPaths=\/mnt\/storage\/aic/);
  assert.match(service, /Requires=aic-strapi-schema\.service/);
  assert.doesNotMatch(service, /docker/i);
  assert.match(service, /ExecStart=\/usr\/local\/libexec\/aic-strapi\/with-aic-db-env\.sh/);
  assert.match(service, /ReadWritePaths=\/mnt\/storage\/aic\/services\/jimwood-cms\/\.tmp/);
  assert.match(service, /ReadWritePaths=\/mnt\/storage\/pastorwood-media\/strapi/);
  assert.match(schemaUnit, /User=ammonsfarm/);
  assert.doesNotMatch(schemaUnit, /docker/i);
  assert.match(schemaUnit, /After=network-online\.target/);
  assert.match(schemaUnit, /Environment=NODE_ENV=production/);
  assert.match(schemaUnit, /UnsetEnvironment=.*STRAPI_NATIVE_CLIENT_TEST_MODE/);
  assert.match(schemaUnit, /RemainAfterExit=yes/);
  assert.match(schemaUnit, /ExecStart=\/usr\/local\/libexec\/aic-strapi\/with-aic-db-env\.sh \/usr\/local\/libexec\/aic-strapi\/ensure-strapi-schema\.sh/);
  assert.match(schemaUnit, /ProtectSystem=strict/);
  assert.match(backupUnit, /ProtectSystem=strict/);
  assert.match(backupUnit, /ExecStart=\/usr\/local\/libexec\/aic-strapi\/run-consistent-backup\.sh/);
  assert.doesNotMatch(backupUnit, /^User=ammonsfarm$/m);
  assert.match(backupUnit, /ReadWritePaths=\/mnt\/storage\/backups\/aic-strapi/);
});

test("coordinated backup quiesces Strapi and drops privileges for database access", () => {
  const script = source("ops/strapi/run-consistent-backup.sh");
  assert.match(script, /systemctl stop "\$\{strapi_service\}"/);
  assert.match(script, /systemctl start "\$\{strapi_service\}"/);
  assert.match(script, /trap 'restart_strapi \$\?' EXIT/);
  assert.match(script, /runuser --user ammonsfarm/);
  assert.match(script, /with-aic-db-env\.sh/);
  assert.match(script, /http:\/\/127\.0\.0\.1:1337\/_health/);
  assert.match(script, /\/run\/aic-strapi\/aic-api-token/);
  assert.match(script, /sync-aic-strapi-env\.sh/);
  assert.doesNotMatch(script, /source .*\.env|pg_restore|CREATE DATABASE|DROP DATABASE/);
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

test("backup verification checks archives, listings, and checksums without a database restore", () => {
  const verify = source("ops/strapi/verify-strapi-backup.sh");
  assert.match(verify, /sha256sum --check SHA256SUMS/);
  assert.match(verify, /canonical_client_root="\/usr\/lib\/postgresql\/16\/bin"/);
  assert.match(verify, /"\$\{pg_restore_bin\}" --list "\$\{backup_dir\}\/database\.dump"/);
  assert.match(verify, /"\$\{pg_restore_bin\}" --exit-on-error --file=\/dev\/null/);
  assert.match(verify, /cmp --silent .*database\.contents/);
  assert.match(verify, /tar --list --gzip/);
  assert.doesNotMatch(verify, /docker|--network/);
  assert.match(verify, /database_schema=aic_strapi/);
  assert.match(verify, /database_host=192\.168\.1\.106/);
  assert.match(verify, /database_port=5432/);
  assert.doesNotMatch(verify, /--dbname|CREATE DATABASE|DROP DATABASE|--clean/);
});

test("backup service can read but never write the canonical environment", () => {
  const service = source("ops/strapi/systemd/aic-strapi-backup.service");
  assert.match(service, /ReadOnlyPaths=\/mnt\/storage\/aic\/\.env/);
  assert.doesNotMatch(service, /ReadWritePaths=\/mnt\/storage\/aic\/\.env/);
  assert.match(service, /ReadWritePaths=\/mnt\/storage\/backups\/aic-strapi/);
  assert.match(service, /ReadOnlyPaths=\/mnt\/storage\/pastorwood-media\/strapi/);
});

test("deploy builds Strapi before installing it and optionally verifies without copying or restoring a database", () => {
  const deploy = source("scripts/deploy-farm-web.sh");
  const preflightIndex = deploy.indexOf('--command "select 1"');
  const quiesceIndex = deploy.indexOf("Quiescing worker and backup timers");
  const fetchIndex = deploy.indexOf("git fetch --all");
  const buildIndex = deploy.indexOf("npm --prefix services/jimwood-cms run build");
  const installIndex = deploy.indexOf("sudo /usr/local/libexec/aic-strapi/install-strapi-service.sh");
  const migrationIndex = deploy.indexOf("apply_postgres_migrations.py --env-file /mnt/storage/aic/.env");
  const strapiHealthIndex = deploy.indexOf("curl -fsS http://127.0.0.1:1337/_health");
  const schemaBackupIndex = deploy.indexOf("systemctl start aic-strapi-backup.service");
  const startTimersIndex = deploy.indexOf('sudo systemctl start "\\${timers_to_start[@]}"');
  assert.ok(preflightIndex >= 0 && quiesceIndex > preflightIndex && fetchIndex > quiesceIndex);
  assert.match(deploy, /with-aic-db-env\.sh \\\n\s+\/usr\/bin\/bash -c 'exec \/usr\/bin\/env/);
  assert.match(deploy, /PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000"/);
  assert.match(deploy, /\/usr\/lib\/postgresql\/16\/bin\/psql/);
  assert.match(deploy, /--host "\\\$\{DATABASE_HOST\}" --port "\\\$\{DATABASE_PORT\}"/);
  assert.match(deploy, /--dbname "\\\$\{DATABASE_NAME\}" --username "\\\$\{DATABASE_USERNAME\}"/);
  assert.match(deploy, /if \[\[ "\\\$\{preflight_result\}" != "1" \]\]/);
  assert.ok(buildIndex >= 0 && installIndex > buildIndex);
  assert.ok(migrationIndex > buildIndex && strapiHealthIndex > installIndex && schemaBackupIndex > strapiHealthIndex);
  assert.ok(startTimersIndex > strapiHealthIndex && startTimersIndex > schemaBackupIndex);
  assert.match(deploy, /all_timers=\([\s\S]*aic-strapi-backup\.timer[\s\S]*\)/);
  assert.match(deploy, /all_worker_services=\([\s\S]*aic-scheduled-publication-worker\.service[\s\S]*\)/);
  assert.match(deploy, /trap 'deployment_failed \\\$\?' EXIT/);
  assert.match(deploy, /migrations_started=1\n\.venv-pg\/bin\/python apply_postgres_migrations\.py/);
  assert.match(deploy, /forward-only migration phase started; no database or code rollback was attempted/);
  assert.doesNotMatch(deploy, /git reset|git checkout\s+--force|pg_restore[^\n]*--dbname/);
  assert.match(deploy, /NODE_ENV=production ops\/strapi\/with-aic-db-env\.sh npm --prefix services\/jimwood-cms run build/);
  assert.match(deploy, /RUN_STRAPI_BACKUP_VERIFY="\$\{RUN_STRAPI_BACKUP_VERIFY:-1\}"/);
  assert.match(deploy, /sudo \/usr\/local\/libexec\/aic-strapi\/verify-strapi-backup\.sh/);
  assert.doesNotMatch(deploy, /RUN_STRAPI_BACKUP_DRILL|restore-drill|createdb|pg_restore[^\n]*--dbname/);
  assert.doesNotMatch(deploy, /publish-reviewed|PUBLISH_REVIEWED_PASTORWOOD_CUTOVER/);
  assert.doesNotMatch(deploy, /PRECHANGE_BACKUP|pre-change backup/i);
});

test("PastorWood cutover defaults to the pinned snapshot, imports drafts, and separates reviewed publication", () => {
  const cutover = source("scripts/pastorwood_cutover_import.py");
  assert.match(cutover, /DEFAULT_WORDPRESS_SNAPSHOT/);
  assert.match(cutover, /default="verified-snapshot"/);
  assert.match(cutover, /PUBLISH_REVIEWED_CONFIRMATION = "PUBLISH_REVIEWED_PASTORWOOD_CUTOVER"/);
  assert.match(cutover, /\/api\/editorial\/\{entity_type\}/);
  assert.match(cutover, /\{\*\*redirect, "active": False\}/);
  assert.match(cutover, /mutationManifestSha256/);
  assert.match(cutover, /Redirect activation refuses a partial reviewed publication phase/);
  assert.doesNotMatch(cutover, /status_query = "\?status=published"/);
  assert.doesNotMatch(cutover, /docker/i);
});
