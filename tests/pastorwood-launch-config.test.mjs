import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const attestationFileName = "pastorwood-public-cms-cutover-attestation.json";

function runLaunchCheck(overrides = {}, worker = "1", inherited = {}, attestationOverrides = null) {
  const sandbox = mkdtempSync(`${tmpdir()}/aic-pastorwood-launch-`);
  const envFile = resolve(sandbox, ".env");
  const values = {
    PASTORWOOD_LAUNCH_STAGE: "development",
    PASTORWOOD_PUBLIC_URL: "https://aic.ammonsfarm.org",
    PASTORWOOD_ALLOW_INDEXING: "false",
    PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED: "false",
    PASTORWOOD_SUBSCRIPTIONS_ENABLED: "false",
    MAILCHIMP_API_KEY: "key-us21",
    MAILCHIMP_SERVER_PREFIX: "us21",
    MAILCHIMP_AUDIENCE_ID: "9ad7bbba36",
    MAILCHIMP_WEBHOOK_SECRET: "webhook",
    SUBSCRIPTION_RATE_LIMIT_SECRET: "rate",
    SUBSCRIPTION_UNSUBSCRIBE_SECRET: "unsubscribe",
    ...overrides,
  };
  const testEvidence = {};
  if (attestationOverrides) {
    const deployedGitRevision = execFileSync(
      "git", ["-C", root, "rev-parse", "--verify", "HEAD^{commit}"], { encoding: "utf8" },
    ).trim();
    const planFingerprint = "a".repeat(64);
    const mutationManifestSha256 = "b".repeat(64);
    const actionsFingerprint = "c".repeat(64);
    const payload = {
      version: 1,
      planFingerprint,
      mutationManifestSha256,
      publication: {
        manifestSha256: "d".repeat(64), evidenceHash: "e".repeat(64), actionsFingerprint,
        expectedActionCount: 2, completedActionCount: 2, verified: true,
      },
      redirectActivation: {
        expectedCount: 1, activatedCount: 1, verifiedCount: 1, evidenceHash: "f".repeat(64),
        activatedLast: true, verified: true,
      },
      cacheInvalidation: {
        state: "complete", flushed: true, actionsFingerprint, completedAt: "2026-07-23T00:00:01.000Z",
      },
      deployedGitRevision,
      completedAt: "2026-07-23T00:00:02.000Z",
      failures: [],
      ...attestationOverrides,
    };
    const raw = `${JSON.stringify(payload, null, 2)}\n`;
    const sha256 = crypto.createHash("sha256").update(raw).digest("hex");
    const attestationPath = resolve(sandbox, attestationFileName);
    writeFileSync(attestationPath, raw);
    writeFileSync(`${attestationPath}.sha256`, `${sha256}  ${attestationFileName}\n`);
    values.PASTORWOOD_CUTOVER_ATTESTATION_SHA256 ??= sha256;
    values.PASTORWOOD_CUTOVER_PLAN_FINGERPRINT ??= planFingerprint;
    values.PASTORWOOD_CUTOVER_MUTATION_MANIFEST_SHA256 ??= mutationManifestSha256;
    values.PASTORWOOD_DEPLOYED_GIT_REVISION ??= deployedGitRevision;
    Object.assign(testEvidence, {
      PASTORWOOD_CUTOVER_ATTESTATION_TEST_MODE: "1",
      PASTORWOOD_CUTOVER_ATTESTATION_TEST_ROOT: sandbox,
      PASTORWOOD_CUTOVER_ATTESTATION_TEST_PATH: attestationPath,
    });
  }
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
      ...testEvidence,
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
    publicCmsCutover: "bootstrap",
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

  const ambiguousCutover = runLaunchCheck({ PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED: "yes" });
  assert.notEqual(ambiguousCutover.status, 0);
  assert.match(ambiguousCutover.stderr, /PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED must be exactly true or false/);
});

test("public CMS launch requires the exact complete cutover attestation", () => {
  const flagOnly = runLaunchCheck({ PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED: "true" });
  assert.notEqual(flagOnly.status, 0);
  assert.match(flagOnly.stderr, /attestation|Git revision/i);

  const complete = runLaunchCheck({ PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED: "true" }, "1", {}, {});
  assert.equal(complete.status, 0, complete.stderr);
  assert.match(complete.stdout, /"publicCmsCutover":"enabled"/);

  const wrongPlan = runLaunchCheck({
    PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED: "true",
    PASTORWOOD_CUTOVER_PLAN_FINGERPRINT: "9".repeat(64),
  }, "1", {}, {});
  assert.notEqual(wrongPlan.status, 0);
  assert.match(wrongPlan.stderr, /plan fingerprint/i);
});
