import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
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
  "require-canonical-db-context.sh",
  "replicate-verified-backups.sh",
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
          guardMatchesProcess: new RegExp('^' + process.pid + ':[0-9a-f]{64}$').test(process.env.AIC_CANONICAL_DB_GUARD || ''),
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
          STRAPI_POSTGRES_CLIENT_ROOT: sandbox,
          STRAPI_NATIVE_CLIENT_TEST_MODE: "1",
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
      guardMatchesProcess: true,
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
          NODE_ENV: "test",
          STRAPI_AIC_ENV_FILE: aicEnv,
          STRAPI_DATABASE_ENV_TEST_MODE: "1",
          STRAPI_POSTGRES_CLIENT_ROOT: sandbox,
          STRAPI_NATIVE_CLIENT_TEST_MODE: "1",
        },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /192\.168\.1\.106:5432/);
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("runtime database mapping rejects duplicate sensitive keys", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aic-strapi-duplicate-db-key-"));
  const aicEnv = join(sandbox, ".env");
  const wrapper = join(opsRoot, "with-aic-db-env.sh");
  try {
    writeFileSync(
      aicEnv,
      "DB_HOST=192.168.1.106\nDB_PORT=5432\nDB_NAME=aic\nDB_USER=aic\nDB_PASSWORD=test\nDB_NAME=alternate\n",
      { mode: 0o600 },
    );
    const result = spawnSync(wrapper, [process.execPath, "-e", "process.exit(0)"], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "test",
        STRAPI_AIC_ENV_FILE: aicEnv,
        STRAPI_DATABASE_ENV_TEST_MODE: "1",
        STRAPI_POSTGRES_CLIENT_ROOT: sandbox,
        STRAPI_NATIVE_CLIENT_TEST_MODE: "1",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Duplicate sensitive database environment key: DB_NAME/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("provisioning keeps application secrets separate and creates only the shared-database schema", () => {
  const provision = source("ops/strapi/provision-strapi.sh");
  const ensureSchema = source("ops/strapi/ensure-strapi-schema.sh");
  const canonicalContext = source("ops/strapi/require-canonical-db-context.sh");

  assert.match(provision, /env_file="\$\{STRAPI_ENV_FILE:-\/etc\/aic\/strapi\.env\}"/);
  assert.match(provision, /secrets_backup="\$\{STRAPI_SECRETS_BACKUP:-\/mnt\/storage\/backups\/aic-strapi-secrets\}"/);
  assert.match(provision, /grep -Eq '\^\(DB_\|DATABASE_\)'/);
  assert.match(provision, /with-aic-db-env\.sh/);
  assert.match(provision, /ensure-strapi-schema\.sh/);
  assert.match(provision, /install -o root -g root -m 0600 "\$\{env_file\}" "\$\{secrets_backup\}\/strapi\.env"/);
  assert.match(provision, /sha256sum --check SHA256SUMS/);
  assert.match(provision, /STRAPI_REVALIDATE_SECRET="\$\(random_hex 32\)"/);
  assert.match(provision, /grep -Ec '\^STRAPI_REVALIDATE_SECRET='/);
  assert.match(provision, /! "\$\{STRAPI_REVALIDATE_SECRET\}" =~ \^\[0-9a-f\]\{64\}\$/);
  assert.match(provision, /mv -f -- "\$\{temporary_env\}" "\$\{env_file\}"/);
  assert.doesNotMatch(provision, /farm-postgres|CREATE DATABASE|CREATE ROLE|database_role=/);
  assert.doesNotMatch(provision, /printf 'DATABASE_|DATABASE_PASSWORD=.*random_hex/);
  assert.doesNotMatch(provision, /^"\$\{ops_root\}\/with-aic-db-env\.sh"/m);

  assert.match(ensureSchema, /require-canonical-db-context\.sh/);
  assert.match(canonicalContext, /DATABASE_SCHEMA:-/);
  assert.match(canonicalContext, /aic_strapi/);
  assert.match(canonicalContext, /192\.168\.1\.106.*5432/);
  assert.match(canonicalContext, /DATABASE_NAME:-.*expected_name/);
  assert.match(canonicalContext, /DATABASE_USERNAME:-.*expected_user/);
  assert.match(canonicalContext, /AIC_CANONICAL_DB_GUARD/);
  assert.match(canonicalContext, /guard%%:\*.*BASHPID/);
  assert.match(ensureSchema, /CREATE SCHEMA IF NOT EXISTS \$\{DATABASE_SCHEMA\} AUTHORIZATION CURRENT_USER/);
  assert.match(ensureSchema, /REVOKE ALL ON SCHEMA \$\{DATABASE_SCHEMA\} FROM PUBLIC/);
  assert.match(ensureSchema, /actual_owner IS DISTINCT FROM current_user/);
  assert.match(ensureSchema, /--host "\$\{DATABASE_HOST\}"/);
  assert.match(ensureSchema, /--dbname "\$\{DATABASE_NAME\}"/);
  assert.doesNotMatch(ensureSchema, /CREATE DATABASE|CREATE ROLE|pg_restore|farm-postgres/);
});

test("canonical database operation guard cannot use test overrides in production", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aic-strapi-production-guard-"));
  const aicEnv = join(sandbox, ".env");
  const wrapper = join(opsRoot, "with-aic-db-env.sh");
  try {
    writeFileSync(
      aicEnv,
      "DB_HOST=192.168.1.106\nDB_PORT=5432\nDB_NAME=aic_contract\nDB_USER=aic\nDB_PASSWORD=test\n",
      { mode: 0o600 },
    );
    const result = spawnSync(wrapper, [process.execPath, "-e", "process.exit(0)"], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        STRAPI_AIC_ENV_FILE: aicEnv,
        STRAPI_DATABASE_ENV_TEST_MODE: "1",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /forbidden in production/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("alternate database environment escape hatch requires an explicit isolated test client", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aic-strapi-test-escape-"));
  const aicEnv = join(sandbox, ".env");
  const wrapper = join(opsRoot, "with-aic-db-env.sh");
  try {
    writeFileSync(
      aicEnv,
      "DB_HOST=192.168.1.106\nDB_PORT=5432\nDB_NAME=aic_contract\nDB_USER=aic\nDB_PASSWORD=test\n",
      { mode: 0o600 },
    );
    const cases = [
      { name: "unset NODE_ENV", nodeEnv: null, nativeMode: "1", clientRoot: sandbox },
      { name: "development NODE_ENV", nodeEnv: "development", nativeMode: "1", clientRoot: sandbox },
      { name: "missing native test mode", nodeEnv: "test", nativeMode: "0", clientRoot: sandbox },
      {
        name: "production client path",
        nodeEnv: "test",
        nativeMode: "1",
        clientRoot: "/usr/lib/postgresql/16/bin",
      },
      { name: "missing stub directory", nodeEnv: "test", nativeMode: "1", clientRoot: join(sandbox, "missing") },
    ];
    for (const item of cases) {
      const environment = {
        ...process.env,
        STRAPI_AIC_ENV_FILE: aicEnv,
        STRAPI_DATABASE_ENV_TEST_MODE: "1",
        STRAPI_POSTGRES_CLIENT_ROOT: item.clientRoot,
        STRAPI_NATIVE_CLIENT_TEST_MODE: item.nativeMode,
      };
      if (item.nodeEnv === null) delete environment.NODE_ENV;
      else environment.NODE_ENV = item.nodeEnv;
      const result = spawnSync(wrapper, [process.execPath, "-e", "process.exit(0)"], {
        encoding: "utf8",
        env: environment,
      });
      assert.notEqual(result.status, 0, item.name);
      assert.match(result.stderr, /explicit non-production stub client root/, item.name);
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("root-executed operations are installed immutably outside the writable checkout", () => {
  const installer = source("ops/strapi/install-strapi-ops.sh");
  const deploy = source("scripts/deploy-farm-web.sh");
  assert.match(installer, /libexec_root="\$\{STRAPI_OPS_ROOT:-\/usr\/local\/libexec\/aic-strapi\}"/);
  assert.match(installer, /install -o root -g root -m 0755/);
  assert.match(installer, /install -o root -g root -m 0644/);
  assert.match(installer, /validate-backup-toc\.py/);
  assert.match(installer, /backup-object-inventory\.txt/);
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

test("production Strapi rejects SQLite, URL repointing, and any schema other than aic_strapi", () => {
  const databaseConfig = source("services/jimwood-cms/config/database.ts");
  const localExample = source("services/jimwood-cms/.env.example");
  const cmsReadme = source("services/jimwood-cms/README.md");
  const service = source("ops/strapi/systemd/aic-strapi.service");
  const wrapper = source("ops/strapi/with-aic-db-env.sh");
  assert.match(databaseConfig, /if \(production && client !== 'postgres'\)/);
  assert.match(databaseConfig, /Production Strapi requires DATABASE_CLIENT=postgres/);
  assert.match(databaseConfig, /Production Strapi does not accept DATABASE_URL/);
  assert.match(databaseConfig, /Production Strapi requires the existing AIC PostgreSQL target at 192\.168\.1\.106:5432/);
  assert.match(databaseConfig, /Production Strapi requires DATABASE_SCHEMA=aic_strapi/);
  assert.match(databaseConfig, /DATABASE_HOST/);
  assert.match(databaseConfig, /DATABASE_PASSWORD/);
  assert.match(localExample, /Local development only/);
  assert.match(localExample, /DATABASE_CLIENT=sqlite/);
  assert.match(cmsReadme, /disposable local UI\/schema development/);
  assert.match(cmsReadme, /not a copy, clone, restore/);
  assert.match(service, /Environment=NODE_ENV=production/);
  assert.match(service, /ExecStart=.*with-aic-db-env\.sh/);
  assert.match(wrapper, /export DATABASE_CLIENT=postgres/);
});

test("all systemd writable paths exist before service namespace setup", () => {
  const provision = source("ops/strapi/provision-strapi.sh");
  const prepareStorage = source("ops/strapi/prepare-strapi-storage.sh");
  const service = source("ops/strapi/systemd/aic-strapi.service");
  const schemaUnit = source("ops/strapi/systemd/aic-strapi-schema.service");
  const backupUnit = source("ops/strapi/systemd/aic-strapi-backup.service");

  assert.equal(
    existsSync(join(repoRoot, "services", "jimwood-cms", "public", "uploads", ".gitkeep")),
    false,
  );
  assert.match(source(".gitignore"), /^\/services\/jimwood-cms\/public\/uploads$/m);
  assert.match(prepareStorage, /uploads_path="\$\{cms_root\}\/public\/uploads"/);
  assert.match(prepareStorage, /ln -s "\$\{media_root\}" "\$\{uploads_path\}"/);

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
  assert.match(backupUnit, /TimeoutStartSec=60m/);
  for (const variable of [
    "STRAPI_BACKUP_TEST_ROOT",
    "STRAPI_BACKUP_ROOT",
    "STRAPI_MEDIA_ROOT",
    "STRAPI_BACKUP_DRY_RUN",
    "STRAPI_BACKUP_RETENTION_DAYS",
  ]) {
    assert.match(backupUnit, new RegExp(`UnsetEnvironment=.*${variable}`));
  }
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
  assert.match(script, /verify_managed_token_sync/);
  assert.match(script, /configured_token.*runtime_token/);
  assert.doesNotMatch(script, /sync-aic-strapi-env\.sh/);
  assert.match(script, /one read-only REPEATABLE READ snapshot/);
  const stopIndex = script.indexOf('systemctl stop "${strapi_service}"');
  const backupIndex = script.lastIndexOf('"${ops_root}/backup-strapi.sh"');
  assert.ok(stopIndex >= 0 && backupIndex > stopIndex);
  assert.doesNotMatch(script, /source .*\.env|pg_restore|CREATE DATABASE|DROP DATABASE/);
});

test("managed Strapi token is scoped, runtime-only, and replaces broad defaults", () => {
  const bootstrap = source("services/jimwood-cms/src/index.ts");
  const unit = source("ops/strapi/systemd/aic-strapi.service");
  assert.match(bootstrap, /type: 'custom'/);
  assert.match(bootstrap, /managedPermissionPrefixes/);
  assert.match(bootstrap, /managedExactPermissions/);
  assert.match(bootstrap, /api::redirect\.redirect\.findOne/);
  assert.doesNotMatch(bootstrap, /'api::redirect\.redirect\.'\s*,/);
  assert.match(bootstrap, /plugin::upload\.content-api\./);
  assert.match(bootstrap, /\['Full Access', 'Read Only'\]/);
  assert.match(bootstrap, /tokenService\.getByName\(broadTokenName\)/);
  assert.match(bootstrap, /outputPath !== managedTokenPath/);
  assert.match(unit, /Environment=AIC_API_TOKEN_OUTPUT_FILE=\/run\/aic-strapi\/aic-api-token/);
  assert.match(unit, /RuntimeDirectory=aic-strapi/);
  assert.match(unit, /RuntimeDirectoryMode=0700/);
  assert.match(unit, /Environment=HOST=127\.0\.0\.1/);
});

test("Strapi environment synchronization serializes the full atomic rewrite", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aic-strapi-env-sync-test-"));
  const aicEnv = join(sandbox, ".env");
  const firstTokenFile = join(sandbox, "first-token");
  const secondTokenFile = join(sandbox, "second-token");
  const strapiEnv = join(sandbox, "strapi.env");
  const lockFile = join(sandbox, "sync.lock");
  const readyFile = join(sandbox, "first-lock-acquired");
  const releaseFile = join(sandbox, "release-first");
  const script = join(opsRoot, "sync-aic-strapi-env.sh");
  const firstToken = "a".repeat(256);
  const secondToken = "b".repeat(256);
  const databaseLines = [
    "DB_HOST=192.168.1.106",
    "DB_PORT=5432",
    "DB_NAME=aic_contract",
    "DB_USER=aic_contract_user",
    "DB_PASSWORD=contract-password",
  ];

  const launch = (tokenFile, coordination = false) => {
    const child = spawn("bash", [script], {
      env: {
        ...process.env,
        NODE_ENV: "test",
        AIC_STRAPI_ENV_SYNC_TEST_MODE: "1",
        AIC_STRAPI_ENV_SYNC_TEST_ROOT: sandbox,
        AIC_ENV_FILE: aicEnv,
        AIC_API_TOKEN_FILE: tokenFile,
        STRAPI_ENV_FILE: strapiEnv,
        AIC_STRAPI_ENV_SYNC_LOCK_FILE: lockFile,
        ...(coordination
          ? {
              AIC_STRAPI_ENV_SYNC_TEST_READY_FILE: readyFile,
              AIC_STRAPI_ENV_SYNC_TEST_RELEASE_FILE: releaseFile,
            }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const completed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve({ code, stdout, stderr }));
    });
    return { child, completed };
  };

  try {
    writeFileSync(aicEnv, `${[...databaseLines, "UNCHANGED_SETTING=preserved", ""].join("\n")}`, { mode: 0o600 });
    writeFileSync(firstTokenFile, `${firstToken}\n`, { mode: 0o600 });
    writeFileSync(secondTokenFile, `${secondToken}\n`, { mode: 0o600 });
    writeFileSync(strapiEnv, `STRAPI_REVALIDATE_SECRET=${"c".repeat(64)}\n`, { mode: 0o600 });

    const first = launch(firstTokenFile, true);
    for (let attempt = 0; attempt < 300 && !existsSync(readyFile); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(existsSync(readyFile), true, "first synchronization never acquired its lock");

    const second = launch(secondTokenFile);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(second.child.exitCode, null, "second synchronization did not wait for the first lock holder");
    assert.doesNotMatch(readFileSync(aicEnv, "utf8"), /^STRAPI_API_TOKEN=/m);

    writeFileSync(releaseFile, "release\n", { mode: 0o600 });
    const [firstResult, secondResult] = await Promise.all([first.completed, second.completed]);
    assert.equal(firstResult.code, 0, firstResult.stderr);
    assert.equal(secondResult.code, 0, secondResult.stderr);

    const finalEnv = readFileSync(aicEnv, "utf8");
    assert.match(finalEnv, new RegExp(`^STRAPI_API_TOKEN=${secondToken}$`, "m"));
    assert.doesNotMatch(finalEnv, new RegExp(`^STRAPI_API_TOKEN=${firstToken}$`, "m"));
    assert.match(finalEnv, /^STRAPI_REVALIDATE_SECRET=[a-f0-9]{64}$/m);
    assert.match(finalEnv, /^UNCHANGED_SETTING=preserved$/m);
    assert.deepEqual(
      finalEnv.split(/\r?\n/).filter((line) => /^DB_(HOST|PORT|NAME|USER|PASSWORD)=/.test(line)),
      databaseLines,
    );
    for (const result of [firstResult, secondResult]) {
      assert.equal(result.stdout.includes(firstToken) || result.stdout.includes(secondToken), false);
      assert.equal(result.stderr.includes(firstToken) || result.stderr.includes(secondToken), false);
    }

    const syncSource = source("ops/strapi/sync-aic-strapi-env.sh");
    const lockIndex = syncSource.indexOf("flock -x 9");
    const snapshotIndex = syncSource.indexOf('snapshot_database_lines "${aic_env}" "${db_before}"');
    const moveIndex = syncSource.indexOf('mv -f -- "${temporary_env}" "${aic_env}"');
    assert.ok(lockIndex >= 0 && snapshotIndex > lockIndex && moveIndex > snapshotIndex);
    assert.match(syncSource, /lock_uid=0\n\s*lock_gid=0/);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("backup verification checks archives, listings, and checksums without a database restore", () => {
  const verify = source("ops/strapi/verify-strapi-backup.sh");
  const inventory = source("ops/strapi/backup-object-inventory.txt").trim().split(/\r?\n/);
  assert.equal(inventory.filter((line) => line.startsWith("table ")).length, 11);
  assert.equal(inventory.filter((line) => line.startsWith("sequence ")).length, 6);
  assert.match(verify, /sha256sum --check SHA256SUMS/);
  assert.match(verify, /canonical_client_root="\/usr\/lib\/postgresql\/16\/bin"/);
  assert.match(verify, /"\$\{pg_restore_bin\}" --list "\$\{backup_dir\}\/aic-strapi-schema\.dump"/);
  assert.match(verify, /"\$\{pg_restore_bin\}" --list "\$\{backup_dir\}\/public-operational\.dump"/);
  assert.equal((verify.match(/"\$\{pg_restore_bin\}" --exit-on-error --file=\/dev\/null/g) ?? []).length, 2);
  assert.match(verify, /cmp --silent .*aic-strapi-schema\.contents/);
  assert.match(verify, /cmp --silent .*public-operational\.contents/);
  assert.match(verify, /validate-backup-toc\.py/);
  assert.match(verify, /tar --list --gzip/);
  assert.doesNotMatch(verify, /docker|--network/);
  assert.match(verify, /database_schema=aic_strapi/);
  assert.match(verify, /database_host=192\.168\.1\.106/);
  assert.match(verify, /database_port=5432/);
  assert.doesNotMatch(verify, /pg_restore[^\n]*(?:--dbname|\s-d\s)|CREATE DATABASE|DROP DATABASE|--clean/);
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
  const restoreRuntime = deploy.slice(
    deploy.indexOf("restore_predeployment_runtime()"),
    deploy.indexOf("deployment_failed()"),
  );
  const preflightIndex = deploy.indexOf('--command "select 1"');
  const strapiPrecheckIndex = deploy.indexOf("Pre-checking the existing private Strapi");
  const quiesceIndex = deploy.indexOf("Quiescing worker and backup timers");
  const stopServicesIndex = deploy.indexOf("Stopping web and private Strapi before mutating release files");
  const fetchIndex = deploy.indexOf("git fetch --all");
  const dependencyInstallIndex = deploy.indexOf("\nnpm ci\n");
  const buildIndex = deploy.indexOf("npm --prefix services/jimwood-cms run build");
  const installIndex = deploy.indexOf("sudo /usr/local/libexec/aic-strapi/install-strapi-service.sh");
  const migrationIndex = deploy.indexOf("apply_postgres_migrations.py --env-file /mnt/storage/aic/.env");
  const strapiHealthIndex = deploy.indexOf("Checking required private Strapi health");
  const existingStrapiRestartIndex = deploy.indexOf("Restarting the previously active private Strapi service");
  const schemaBackupIndex = deploy.indexOf("systemctl start aic-strapi-backup.service");
  const backupVerifyIndex = deploy.indexOf("/usr/local/libexec/aic-strapi/verify-strapi-backup.sh");
  const backupTimerEnableIndex = deploy.indexOf("systemctl enable aic-strapi-backup.timer");
  const backupTimerAppendIndex = deploy.indexOf("timers_to_start+=(aic-strapi-backup.timer)");
  const startTimersIndex = deploy.indexOf('sudo systemctl start "\\${timers_to_start[@]}"');
  assert.ok(preflightIndex >= 0 && quiesceIndex > preflightIndex && fetchIndex > quiesceIndex);
  assert.ok(strapiPrecheckIndex > preflightIndex && strapiPrecheckIndex < quiesceIndex);
  assert.ok(stopServicesIndex > quiesceIndex && fetchIndex > stopServicesIndex);
  assert.ok(dependencyInstallIndex > stopServicesIndex);
  assert.match(deploy, /with-aic-db-env\.sh \\\n\s+\/usr\/bin\/bash -c 'exec \/usr\/bin\/env/);
  assert.match(deploy, /PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000"/);
  assert.match(deploy, /\/usr\/lib\/postgresql\/16\/bin\/psql/);
  assert.match(deploy, /--host "\\\$\{DATABASE_HOST\}" --port "\\\$\{DATABASE_PORT\}"/);
  assert.match(deploy, /--dbname "\\\$\{DATABASE_NAME\}" --username "\\\$\{DATABASE_USERNAME\}"/);
  assert.match(deploy, /if \[\[ "\\\$\{preflight_result\}" != "1" \]\]/);
  assert.ok(buildIndex >= 0 && installIndex > buildIndex);
  assert.ok(migrationIndex > buildIndex && strapiHealthIndex > installIndex && schemaBackupIndex > strapiHealthIndex);
  assert.ok(startTimersIndex > strapiHealthIndex && startTimersIndex > schemaBackupIndex);
  assert.ok(
    schemaBackupIndex < backupVerifyIndex
      && backupVerifyIndex < backupTimerEnableIndex
      && backupTimerEnableIndex < backupTimerAppendIndex
      && backupTimerAppendIndex < startTimersIndex,
  );
  assert.ok(existingStrapiRestartIndex > migrationIndex && existingStrapiRestartIndex < strapiHealthIndex);
  assert.match(deploy, /all_timers=\([\s\S]*aic-strapi-backup\.timer[\s\S]*\)/);
  assert.match(deploy, /all_worker_services=\([\s\S]*aic-scheduled-publication-worker\.service[\s\S]*\)/);
  assert.match(deploy, /all_timers=\([\s\S]*aic-public-data-retention-worker\.timer[\s\S]*\)/);
  assert.match(deploy, /all_worker_services=\([\s\S]*aic-public-data-retention-worker\.service[\s\S]*\)/);
  assert.match(deploy, /START_TIMER=0 bash scripts\/install-public-data-retention-worker\.sh/);
  assert.match(deploy, /trap 'deployment_failed \\\$\?' EXIT/);
  assert.match(deploy, /migrations_started=1\n\.venv-pg\/bin\/python apply_postgres_migrations\.py/);
  assert.match(deploy, /forward-only migration phase started; no database or code rollback was attempted/);
  assert.match(deploy, /restore_predeployment_runtime\(\)[\s\S]*sudo systemctl start "\\\$\{previous_active_timers\[@\]\}"/);
  assert.match(deploy, /deployment_failed\(\)[\s\S]*restore_predeployment_runtime \|\| rollback_ok=0/);
  assert.match(deploy, /stop_release_runtime\(\)[\s\S]*sudo systemctl stop "\$\{REMOTE_SERVICE\}"[\s\S]*sudo systemctl stop aic-strapi\.service/);
  assert.match(deploy, /Stopping web and private Strapi[\s\S]*systemctl stop "\\\$\{service\}"[^\n]*\|\| true[\s\S]*systemctl is-active --quiet "\\\$\{service\}"/);
  assert.match(restoreRuntime, /systemctl stop aic-strapi\.service[^\n]*\|\| true/);
  assert.match(restoreRuntime, /if sudo systemctl is-active --quiet aic-strapi\.service; then\n\s+return 1/);
  assert.match(deploy, /Release runtime is fail-closed: web, Strapi, workers, and timers were stopped/);
  assert.match(
    deploy,
    /if \[ "\$\{INSTALL_STRAPI_SERVICE\}" = "0" \][\s\S]*?INSTALL_SCHEDULED_PUBLICATION_WORKER[\s\S]*?INSTALL_EPISODE_PUBLISH_WORKER[\s\S]*?Pre-checking the existing private Strapi/,
  );
  assert.match(
    deploy,
    /if \[ "\$\{INSTALL_STRAPI_SERVICE\}" = "1" \][\s\S]*?\[ "\$\{INSTALL_SCHEDULED_PUBLICATION_WORKER\}" = "1" \][\s\S]*?\[ "\$\{INSTALL_EPISODE_PUBLISH_WORKER\}" = "1" \][\s\S]*?strapi_was_active[\s\S]*?systemctl is-active --quiet aic-strapi\.service[\s\S]*?wait_for_strapi_health/,
  );
  assert.doesNotMatch(deploy, /git reset|git checkout\s+--force|pg_restore[^\n]*--dbname/);
  assert.match(deploy, /NODE_ENV=production ops\/strapi\/with-aic-db-env\.sh npm --prefix services\/jimwood-cms run build/);
  assert.match(deploy, /RUN_STRAPI_BACKUP_VERIFY="\$\{RUN_STRAPI_BACKUP_VERIFY:-1\}"/);
  assert.match(deploy, /sudo \/usr\/local\/libexec\/aic-strapi\/verify-strapi-backup\.sh/);
  assert.match(deploy, /disable --now aic-strapi-backup\.timer/);
  assert.match(deploy, /Backup verification was skipped; the Strapi backup timer remains disabled/);
  const serviceInstaller = source("ops/strapi/install-strapi-service.sh");
  assert.match(serviceInstaller, /systemctl enable aic-strapi\.service >\/dev\/null/);
  assert.match(serviceInstaller, /systemctl disable --now aic-strapi-backup\.timer/);
  assert.doesNotMatch(serviceInstaller, /systemctl enable aic-strapi\.service aic-strapi-backup\.timer/);
  assert.doesNotMatch(deploy, /RUN_STRAPI_BACKUP_DRILL|restore-drill|createdb|pg_restore[^\n]*--dbname/);
  assert.doesNotMatch(deploy, /publish-reviewed|PUBLISH_REVIEWED_PASTORWOOD_CUTOVER/);
  assert.doesNotMatch(deploy, /PRECHANGE_BACKUP|pre-change backup/i);
});

test("PastorWood cutover defaults to the pinned snapshot, imports drafts, and separates reviewed publication", () => {
  const cutover = source("scripts/pastorwood_cutover_import.py");
  const publicationStart = cutover.indexOf("def publish_reviewed_plan(");
  const publicationEnd = cutover.indexOf("\ndef build_plan(", publicationStart);
  const publication = cutover.slice(publicationStart, publicationEnd);
  const reviewedSealIndex = publication.indexOf("args.reviewed_mutation_manifest_sha256");
  const exactManifestIndex = publication.indexOf("set(mutation_records) != set(expected_entries)");
  const mediaRehashIndex = publication.indexOf("verify_phase1_public_media_evidence(");
  const clientIndex = publication.indexOf('canonical_strapi_client(payloads["env"])');
  const publishIndex = publication.indexOf("client.publish_reviewed(");
  const firstPendingIndex = publication.indexOf("mark_cache_invalidation_pending()", publication.indexOf("publish_entries ="));
  const initialFlushIndex = publication.indexOf('if cache_invalidation_state == "pending":');
  const attestationIndex = publication.indexOf("build_cutover_attestation(");
  assert.match(cutover, /DEFAULT_WORDPRESS_SNAPSHOT/);
  assert.match(cutover, /default="verified-snapshot"/);
  assert.match(cutover, /wordpress_sources = \("verified-snapshot",\)/);
  assert.match(cutover, /os\.environ\.get\("NODE_ENV"\) == "test"[\s\S]*DIRECT_WORDPRESS_REFRESH_TEST_MODE_ENV/);
  assert.match(cutover, /Direct WordPress database refresh is unavailable outside explicit non-production test mode/);
  assert.match(cutover, /pastorwood-reviewed-media-dispositions\.json/);
  assert.match(cutover, /--reviewed-mutation-manifest-sha256/);
  assert.match(cutover, /exact independently confirmed phase-one mutation manifest SHA-256/);
  assert.match(cutover, /Reviewed media dispositions must be tracked and unchanged from the deployed commit/);
  assert.match(cutover, /mediaReferenceCoverage/);
  assert.match(cutover, /finalMediaTargetAudit/);
  assert.match(cutover, /publicMediaEvidence/);
  assert.match(cutover, /wp-sermon:\[0-9\]\+\|cms_\[a-z0-9\]/);
  assert.match(cutover, /PUBLISH_REVIEWED_CONFIRMATION = "PUBLISH_REVIEWED_PASTORWOOD_CUTOVER"/);
  assert.match(cutover, /if publishable and api_path in \{"pages", "posts", "episodes"\}:[\s\S]*mutation_data\["scheduledFor"\] = None/);
  assert.match(cutover, /\/api\/editorial\/\{entity_type\}/);
  assert.match(cutover, /\{\*\*redirect, "active": False\}/);
  assert.match(cutover, /mutationManifestSha256/);
  assert.match(cutover, /PUBLIC_CACHE_INVALIDATION_URL = "http:\/\/127\.0\.0\.1:8087\/api\/revalidate\/strapi"/);
  assert.match(cutover, /"event": "entry\.publish", "source": source/);
  assert.match(cutover, /payload\.get\("revalidated"\) is not True/);
  assert.match(cutover, /"cacheInvalidation": \{/);
  assert.match(cutover, /"actionsFingerprint": stable_fingerprint\(ordered_actions\)/);
  assert.match(cutover, /os\.fsync\(handle\.fileno\(\)\)/);
  assert.match(cutover, /os\.fsync\(directory_descriptor\)/);
  assert.match(cutover, /Redirect activation refuses a partial reviewed publication phase/);
  assert.match(cutover, /DEFAULT_CUTOVER_ATTESTATION = DEFAULT_MIGRATION_ROOT \/ "pastorwood-public-cms-cutover-attestation\.json"/);
  assert.match(cutover, /temporary_paths\[0\]\.replace\(checksum_path\)[\s\S]*temporary_paths\[1\]\.replace\(path\)/);
  assert.match(cutover, /"activatedLast": True/);
  assert.match(cutover, /"deployedGitRevision": git_revision/);
  assert.ok(publicationStart >= 0 && publicationEnd > publicationStart);
  assert.ok(reviewedSealIndex >= 0 && exactManifestIndex > reviewedSealIndex && mediaRehashIndex > exactManifestIndex);
  assert.ok(clientIndex > mediaRehashIndex && publishIndex > clientIndex);
  assert.ok(initialFlushIndex >= 0 && initialFlushIndex < clientIndex);
  assert.ok(firstPendingIndex >= 0 && firstPendingIndex < publishIndex);
  assert.ok(attestationIndex > publication.lastIndexOf("flush_cache_invalidation()"));
  assert.match(publication, /publicMediaVerification/);
  assert.doesNotMatch(publication, /copy_public_media\(/);
  assert.doesNotMatch(cutover, /status_query = "\?status=published"/);
  assert.doesNotMatch(cutover, /docker/i);
});

test("PastorWood cutover authority uses only the existing AIC catalog and MinIO inventory", () => {
  const cutover = source("scripts/pastorwood_cutover_import.py");
  const episodeStart = cutover.indexOf("def build_episodes(");
  const episodeEnd = cutover.indexOf("\ndef reconcile_episode_media(", episodeStart);
  const buildPlanStart = cutover.indexOf("def build_plan(");
  const buildPlanEnd = cutover.indexOf("\ndef validate_cutover_authority(", buildPlanStart);
  const applyStart = cutover.indexOf("def apply_plan(");
  const applyEnd = cutover.indexOf("\ndef expected_cutover_entries(", applyStart);
  const episodes = cutover.slice(episodeStart, episodeEnd);
  const buildPlan = cutover.slice(buildPlanStart, buildPlanEnd);
  const applyPlan = cutover.slice(applyStart, applyEnd);

  assert.match(cutover, /CUTOVER_AUTHORITY = "aic-postgresql-and-minio-canonical-v1"/);
  assert.match(episodes, /WordPress sermons are intentionally report-only/);
  assert.match(episodes, /"externalAudioUrl": public_episode_media_url\(track_id\)/);
  assert.match(episodes, /"status": "excluded-wordpress-sermon"/);
  assert.match(episodes, /return sorted\(episodes,[\s\S]*\), \[\]/);
  assert.doesNotMatch(episodes, /match_episodes\(/);
  assert.doesNotMatch(episodes, /build_sermon_audio_content_evidence\(/);
  assert.doesNotMatch(episodes, /"trackId": f"wp-sermon:/);
  assert.match(buildPlan, /media_records: list\[MediaRecord\] = \[\]/);
  assert.match(buildPlan, /redirects: list\[dict\[str, Any\]\] = \[\]/);
  assert.match(buildPlan, /validate_cutover_authority\(plan\)/);
  assert.doesNotMatch(buildPlan, /build_media_records\(/);
  assert.doesNotMatch(buildPlan, /build_redirects\(/);
  assert.match(applyPlan, /Cutover authority prohibits WordPress media-asset mutations/);
  assert.match(applyPlan, /Cutover authority prohibits legacy redirect mutations/);
  assert.match(cutover, /--copy-media is prohibited: the existing canonical media inventory wins/);
  assert.match(cutover, /--apply requires --verify-episode-audio/);
});
