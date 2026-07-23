import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const script = join(root, "scripts", "configure-pastorwood-development-env.py");
const confirmation = "CONFIGURE_PASTORWOOD_DEVELOPMENT";
const databaseLines = [
  'export DB_HOST="192.168.1.106"',
  "DB_PORT = '5432'",
  "DB_NAME=aic_existing",
  "DB_USER=aic_existing_user",
  "DB_PASSWORD=database-secret-must-not-print",
];

function canonicalFixture(extra = []) {
  return [
    "# canonical AIC environment",
    ...databaseLines,
    "MAILCHIMP_API_KEY=provider-secret-must-not-print",
    "CLERK_SECRET_KEY=clerk-secret-must-not-print",
    "UNRELATED_SETTING=preserve=this=exactly",
    ...extra,
    "",
  ].join("\n");
}

function sandboxFor(content = canonicalFixture()) {
  const sandbox = mkdtempSync("/tmp/aic-pastorwood-development-env-test-");
  const envFile = join(sandbox, ".env");
  const lockFile = join(sandbox, "sync.lock");
  writeFileSync(envFile, content, { mode: 0o600 });
  return { sandbox, envFile, lockFile };
}

function testEnvironment({ sandbox, envFile, lockFile }, extra = {}) {
  return {
    ...process.env,
    NODE_ENV: "test",
    PASTORWOOD_DEVELOPMENT_ENV_TEST_MODE: "1",
    PASTORWOOD_DEVELOPMENT_ENV_TEST_ROOT: sandbox,
    PASTORWOOD_DEVELOPMENT_ENV_TEST_ENV_FILE: envFile,
    PASTORWOOD_DEVELOPMENT_ENV_TEST_LOCK_FILE: lockFile,
    ...extra,
  };
}

function run(fixture, options = {}) {
  return spawnSync(script, [options.confirmation ?? confirmation], {
    encoding: "utf8",
    env: testEnvironment(fixture, options.inherited),
  });
}

function sensitiveLines(content, expression) {
  return content.split(/\r?\n/).filter((line) => expression.test(line));
}

test("development configurator changes only the five launch gates and is idempotent", () => {
  const fixture = sandboxFor(canonicalFixture([
    "PASTORWOOD_LAUNCH_STAGE=production-cutover",
    "PASTORWOOD_PUBLIC_URL=https://www.pastorwood.org",
    "PASTORWOOD_ALLOW_INDEXING=true",
  ]));
  try {
    const first = run(fixture, {
      inherited: {
        DB_HOST: "127.0.0.1",
        DB_PORT: "9999",
        DATABASE_URL: "postgres://wrong.invalid/wrong",
        PGHOST: "wrong.invalid",
        PASTORWOOD_LAUNCH_STAGE: "production-cutover",
        PASTORWOOD_PUBLIC_URL: "https://wrong.invalid",
        PASTORWOOD_ALLOW_INDEXING: "true",
        PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED: "true",
        PASTORWOOD_SUBSCRIPTIONS_ENABLED: "true",
        MAILCHIMP_API_KEY: "wrong-inherited-provider-secret",
      },
    });
    assert.equal(first.status, 0, first.stderr);
    const configured = readFileSync(fixture.envFile, "utf8");
    assert.deepEqual(
      sensitiveLines(configured, /^(?:export )?DB_(?:HOST|PORT|NAME|USER|PASSWORD)\s*=/),
      databaseLines,
    );
    for (const line of [
      "MAILCHIMP_API_KEY=provider-secret-must-not-print",
      "CLERK_SECRET_KEY=clerk-secret-must-not-print",
      "UNRELATED_SETTING=preserve=this=exactly",
    ]) {
      assert.equal(configured.split("\n").includes(line), true);
    }
    assert.deepEqual(
      sensitiveLines(configured, /^PASTORWOOD_(?:LAUNCH_STAGE|PUBLIC_URL|ALLOW_INDEXING|PUBLIC_CMS_CUTOVER_ENABLED|SUBSCRIPTIONS_ENABLED)=/),
      [
        "PASTORWOOD_LAUNCH_STAGE=development",
        "PASTORWOOD_PUBLIC_URL=https://aic.ammonsfarm.org",
        "PASTORWOOD_ALLOW_INDEXING=false",
        "PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED=false",
        "PASTORWOOD_SUBSCRIPTIONS_ENABLED=false",
      ],
    );
    assert.equal(statSync(fixture.envFile).mode & 0o777, 0o600);
    for (const secret of [
      "database-secret-must-not-print",
      "provider-secret-must-not-print",
      "clerk-secret-must-not-print",
      "wrong-inherited-provider-secret",
    ]) {
      assert.equal(`${first.stdout}${first.stderr}`.includes(secret), false);
    }

    const firstStat = statSync(fixture.envFile);
    const second = run(fixture);
    assert.equal(second.status, 0, second.stderr);
    const secondStat = statSync(fixture.envFile);
    assert.equal(readFileSync(fixture.envFile, "utf8"), configured);
    assert.equal(secondStat.ino, firstStat.ino, "an idempotent run should not replace the file");
  } finally {
    rmSync(fixture.sandbox, { recursive: true, force: true });
  }
});

test("literal confirmation and strict isolated test mode fail before mutation", () => {
  const fixture = sandboxFor();
  const original = readFileSync(fixture.envFile);
  try {
    const wrongConfirmation = run(fixture, { confirmation: "YES" });
    assert.notEqual(wrongConfirmation.status, 0);
    assert.match(wrongConfirmation.stderr, /Literal confirmation required/);

    const wrongNodeEnv = spawnSync(script, [confirmation], {
      encoding: "utf8",
      env: testEnvironment(fixture, { NODE_ENV: "development" }),
    });
    assert.notEqual(wrongNodeEnv.status, 0);
    assert.match(wrongNodeEnv.stderr, /requires NODE_ENV=test/);
    assert.deepEqual(readFileSync(fixture.envFile), original);
  } finally {
    rmSync(fixture.sandbox, { recursive: true, force: true });
  }
});

test("duplicate managed, database, and routing keys are rejected without mutation", () => {
  const duplicateCases = [
    ["managed", ["PASTORWOOD_LAUNCH_STAGE=development", "PASTORWOOD_LAUNCH_STAGE=production-cutover"]],
    ["database", ["DB_NAME=alternate"]],
    ["routing", ["PGHOST=192.168.1.106", "PGHOST=alternate.invalid"]],
  ];
  for (const [name, extra] of duplicateCases) {
    const fixture = sandboxFor(canonicalFixture(extra));
    const original = readFileSync(fixture.envFile);
    try {
      const result = run(fixture);
      assert.notEqual(result.status, 0, name);
      assert.match(result.stderr, /duplicate/i, name);
      assert.deepEqual(readFileSync(fixture.envFile), original, name);
    } finally {
      rmSync(fixture.sandbox, { recursive: true, force: true });
    }
  }
});

test("a single database routing override is rejected without mutation", () => {
  const fixture = sandboxFor(canonicalFixture(["PGHOST=hostile-routing.invalid"]));
  const original = readFileSync(fixture.envFile);
  try {
    const result = run(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /forbidden database routing key PGHOST/);
    assert.deepEqual(readFileSync(fixture.envFile), original);
  } finally {
    rmSync(fixture.sandbox, { recursive: true, force: true });
  }
});

test("the exact existing database host and port are mandatory", () => {
  for (const [host, port] of [["127.0.0.1", "5432"], ["192.168.1.106", "5433"]]) {
    const content = canonicalFixture()
      .replace('export DB_HOST="192.168.1.106"', `DB_HOST=${host}`)
      .replace("DB_PORT = '5432'", `DB_PORT=${port}`);
    const fixture = sandboxFor(content);
    const original = readFileSync(fixture.envFile);
    try {
      const result = run(fixture);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /192\.168\.1\.106:5432/);
      assert.deepEqual(readFileSync(fixture.envFile), original);
    } finally {
      rmSync(fixture.sandbox, { recursive: true, force: true });
    }
  }
});

test("environment and lock symlinks are rejected", () => {
  const fixture = sandboxFor();
  const realEnv = fixture.envFile;
  const linkedEnv = join(fixture.sandbox, "linked.env");
  symlinkSync(realEnv, linkedEnv);
  try {
    const envResult = run({ ...fixture, envFile: linkedEnv });
    assert.notEqual(envResult.status, 0);
    assert.match(envResult.stderr, /regular file|symlink/i);

    const realLock = join(fixture.sandbox, "real.lock");
    writeFileSync(realLock, "", { mode: 0o600 });
    const linkedLock = join(fixture.sandbox, "linked.lock");
    symlinkSync(realLock, linkedLock);
    const lockResult = run({ ...fixture, lockFile: linkedLock });
    assert.notEqual(lockResult.status, 0);
    assert.match(lockResult.stderr, /unsafe.*lock/i);
    assert.equal(lstatSync(linkedLock).isSymbolicLink(), true);
  } finally {
    rmSync(fixture.sandbox, { recursive: true, force: true });
  }
});

test("the shared lock serializes concurrent full rewrites", async () => {
  const fixture = sandboxFor();
  const readyFile = join(fixture.sandbox, "first-ready");
  const releaseFile = join(fixture.sandbox, "release-first");
  const launch = (coordination) => {
    const child = spawn(script, [confirmation], {
      env: testEnvironment(fixture, coordination ? {
        PASTORWOOD_DEVELOPMENT_ENV_TEST_READY_FILE: readyFile,
        PASTORWOOD_DEVELOPMENT_ENV_TEST_RELEASE_FILE: releaseFile,
      } : {}),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    return {
      child,
      completed: new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => resolve({ code, stdout, stderr }));
      }),
    };
  };

  try {
    const first = launch(true);
    for (let attempt = 0; attempt < 500 && !existsSync(readyFile); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(existsSync(readyFile), true, "first configurator never acquired its lock");
    const second = launch(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(second.child.exitCode, null, "second configurator bypassed the shared lock");

    writeFileSync(releaseFile, "release\n", { mode: 0o600 });
    const [firstResult, secondResult] = await Promise.all([first.completed, second.completed]);
    assert.equal(firstResult.code, 0, firstResult.stderr);
    assert.equal(secondResult.code, 0, secondResult.stderr);
    const configured = readFileSync(fixture.envFile, "utf8");
    assert.match(configured, /^PASTORWOOD_LAUNCH_STAGE=development$/m);
    assert.match(configured, /^PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED=false$/m);
    assert.match(configured, /^PASTORWOOD_SUBSCRIPTIONS_ENABLED=false$/m);
  } finally {
    rmSync(fixture.sandbox, { recursive: true, force: true });
  }
});

test("deployment wiring is explicit, disabled by default, and ordered before launch checks", () => {
  const deploy = readFileSync(join(root, "scripts", "deploy-farm-web.sh"), "utf8");
  assert.match(deploy, /CONFIGURE_PASTORWOOD_DEVELOPMENT_ENV="\$\{CONFIGURE_PASTORWOOD_DEVELOPMENT_ENV:-0\}"/);
  assert.match(deploy, /if \[ "\$\{CONFIGURE_PASTORWOOD_DEVELOPMENT_ENV\}" = "1" \]; then/);
  assert.match(deploy, /aic-configure-pastorwood-development-env CONFIGURE_PASTORWOOD_DEVELOPMENT/);
  const pullIndex = deploy.indexOf('git pull --ff-only origin "${REMOTE_BRANCH}"');
  const configureIndex = deploy.indexOf("aic-configure-pastorwood-development-env CONFIGURE_PASTORWOOD_DEVELOPMENT");
  const checkIndex = deploy.indexOf("node scripts/check-pastorwood-launch-config.mjs");
  assert.ok(pullIndex >= 0 && configureIndex > pullIndex && checkIndex > configureIndex);

  const configurator = readFileSync(script, "utf8");
  assert.match(configurator, /CANONICAL_ENV = "\/mnt\/storage\/aic\/\.env"/);
  assert.match(configurator, /CANONICAL_LOCK = "\/run\/lock\/aic-strapi-env-sync\.lock"/);
  assert.doesNotMatch(configurator, /psycopg|psql|pg_dump|pg_restore|CREATE DATABASE|DROP DATABASE/);
  assert.notEqual(statSync(script).mode & 0o111, 0);
});
