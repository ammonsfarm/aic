import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function runLaunchCheck(overrides = {}, worker = "1", inherited = {}) {
  const sandbox = mkdtempSync(`${tmpdir()}/aic-pastorwood-launch-`);
  const envFile = resolve(sandbox, ".env");
  const values = {
    PASTORWOOD_LAUNCH_STAGE: "development",
    PASTORWOOD_PUBLIC_URL: "https://aic.ammonsfarm.org",
    PASTORWOOD_ALLOW_INDEXING: "false",
    PASTORWOOD_SUBSCRIPTIONS_ENABLED: "false",
    MAILCHIMP_API_KEY: "key-us21",
    MAILCHIMP_SERVER_PREFIX: "us21",
    MAILCHIMP_AUDIENCE_ID: "9ad7bbba36",
    MAILCHIMP_WEBHOOK_SECRET: "webhook",
    SUBSCRIPTION_RATE_LIMIT_SECRET: "rate",
    SUBSCRIPTION_UNSUBSCRIBE_SECRET: "unsubscribe",
    ...overrides,
  };
  writeFileSync(envFile, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
  const result = spawnSync(process.execPath, [
    "scripts/check-pastorwood-launch-config.mjs",
    "--env-file", envFile,
    "--subscription-worker-enabled", worker,
  ], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      ...inherited,
      NODE_ENV: "test",
      PASTORWOOD_LAUNCH_CONFIG_TEST_MODE: "1",
    },
  });
  rmSync(sandbox, { recursive: true, force: true });
  return result;
}

test("canonical file values keep signup off even when inherited state says true", () => {
  const result = runLaunchCheck({}, "0", { PASTORWOOD_SUBSCRIPTIONS_ENABLED: "true" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    launchStage: "development",
    publicOrigin: "development",
    publicIndexing: "disabled",
    subscriptionRuntime: "disabled",
    subscriptionProvider: "ready",
    subscriptionWorker: "disabled",
  });
});

test("enabled signup requires both complete provider settings and the worker", () => {
  assert.equal(runLaunchCheck({ PASTORWOOD_SUBSCRIPTIONS_ENABLED: "true" }, "1").status, 0);

  const noWorker = runLaunchCheck({ PASTORWOOD_SUBSCRIPTIONS_ENABLED: "true" }, "0");
  assert.notEqual(noWorker.status, 0);
  assert.match(noWorker.stderr, /provider worker install toggle is disabled/i);

  const incomplete = runLaunchCheck({
    PASTORWOOD_SUBSCRIPTIONS_ENABLED: "true",
    MAILCHIMP_WEBHOOK_SECRET: "",
  });
  assert.notEqual(incomplete.status, 0);
  assert.match(incomplete.stderr, /complete provider configuration/i);
});

test("development and production-cutover stages require their exact origins", () => {
  const production = runLaunchCheck({
    PASTORWOOD_LAUNCH_STAGE: "production-cutover",
    PASTORWOOD_PUBLIC_URL: "https://www.pastorwood.org",
  });
  assert.equal(production.status, 0, production.stderr);
  assert.match(production.stdout, /"launchStage":"production-cutover"/);

  const wrongOrigin = runLaunchCheck({ PASTORWOOD_PUBLIC_URL: "https://preview.example.test" });
  assert.notEqual(wrongOrigin.status, 0);
  assert.match(wrongOrigin.stderr, /does not match the explicit development launch stage/i);

  const productionOnDevelopment = runLaunchCheck({ PASTORWOOD_PUBLIC_URL: "https://www.pastorwood.org" });
  assert.notEqual(productionOnDevelopment.status, 0);
  const developmentOnProduction = runLaunchCheck({ PASTORWOOD_LAUNCH_STAGE: "production-cutover" });
  assert.notEqual(developmentOnProduction.status, 0);

  const indexedDevelopment = runLaunchCheck({ PASTORWOOD_ALLOW_INDEXING: "true" });
  assert.notEqual(indexedDevelopment.status, 0);
  assert.match(indexedDevelopment.stderr, /development.*indexing disabled/i);
});

test("launch checks reject an ambiguous subscription gate", () => {
  const ambiguous = runLaunchCheck({ PASTORWOOD_SUBSCRIPTIONS_ENABLED: "yes" });
  assert.notEqual(ambiguous.status, 0);
  assert.match(ambiguous.stderr, /exactly true or false/i);
});
