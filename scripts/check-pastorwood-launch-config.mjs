#!/usr/bin/env node

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import attestationModule from "../lib/pastorwood-cutover-attestation.js";

const { validatePastorWoodCutoverAttestation } = attestationModule;

const CANONICAL_ENV_FILE = "/mnt/storage/aic/.env";
const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PUBLIC_ORIGINS = {
  development: "https://aic.ammonsfarm.org",
  "production-cutover": "https://www.pastorwood.org",
};
const MANAGED_KEYS = [
  "PASTORWOOD_LAUNCH_STAGE",
  "PASTORWOOD_PUBLIC_URL",
  "PASTORWOOD_ALLOW_INDEXING",
  "PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED",
  "PASTORWOOD_CUTOVER_ATTESTATION_SHA256",
  "PASTORWOOD_CUTOVER_PLAN_FINGERPRINT",
  "PASTORWOOD_CUTOVER_MUTATION_MANIFEST_SHA256",
  "PASTORWOOD_DEPLOYED_GIT_REVISION",
  "PASTORWOOD_SUBSCRIPTIONS_ENABLED",
  "MAILCHIMP_API_KEY",
  "MAILCHIMP_SERVER_PREFIX",
  "MAILCHIMP_AUDIENCE_ID",
  "MAILCHIMP_WEBHOOK_SECRET",
  "SUBSCRIPTION_RATE_LIMIT_SECRET",
  "SUBSCRIPTION_UNSUBSCRIBE_SECRET",
];
const PROVIDER_KEYS = [
  "MAILCHIMP_API_KEY",
  "MAILCHIMP_SERVER_PREFIX",
  "MAILCHIMP_AUDIENCE_ID",
  "MAILCHIMP_WEBHOOK_SECRET",
  "SUBSCRIPTION_RATE_LIMIT_SECRET",
  "SUBSCRIPTION_UNSUBSCRIBE_SECRET",
];

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

const testMode = process.env.PASTORWOOD_LAUNCH_CONFIG_TEST_MODE === "1" && process.env.NODE_ENV !== "production";
const envFile = argument("--env-file") || CANONICAL_ENV_FILE;
const workerEnabled = argument("--subscription-worker-enabled");

if ((!testMode && path.resolve(envFile) !== CANONICAL_ENV_FILE) || !fs.existsSync(envFile)) {
  throw new Error(`PastorWood launch checks require the canonical environment at ${CANONICAL_ENV_FILE}.`);
}
if (workerEnabled !== "0" && workerEnabled !== "1") {
  throw new Error("Subscription provider worker readiness must be supplied as 0 or 1.");
}

function readAuthoritativeValues(filePath) {
  const values = new Map();
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!MANAGED_KEYS.includes(key)) continue;
    if (values.has(key)) throw new Error(`Canonical environment contains duplicate ${key} entries.`);
    values.set(key, trimmed.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, "$2"));
  }
  return values;
}

const values = readAuthoritativeValues(envFile);
const launchStage = values.get("PASTORWOOD_LAUNCH_STAGE") || "";
if (!(launchStage in PUBLIC_ORIGINS)) {
  throw new Error("PASTORWOOD_LAUNCH_STAGE must be exactly development or production-cutover.");
}
let publicUrl;
try {
  publicUrl = new URL(values.get("PASTORWOOD_PUBLIC_URL") || "");
} catch {
  throw new Error("PASTORWOOD_PUBLIC_URL must be the canonical HTTPS PastorWood origin.");
}
if (
  publicUrl.origin !== PUBLIC_ORIGINS[launchStage]
  || (publicUrl.pathname !== "/" && publicUrl.pathname !== "")
  || publicUrl.search
  || publicUrl.hash
  || publicUrl.username
  || publicUrl.password
) {
  throw new Error(`PASTORWOOD_PUBLIC_URL does not match the explicit ${launchStage} launch stage.`);
}

const indexingValue = (values.get("PASTORWOOD_ALLOW_INDEXING") || "false").toLowerCase();
if (indexingValue !== "true" && indexingValue !== "false") {
  throw new Error("PASTORWOOD_ALLOW_INDEXING must be exactly true or false.");
}
if (launchStage === "development" && indexingValue !== "false") {
  throw new Error("Development PastorWood deployments must keep public indexing disabled.");
}

const publicCmsCutoverValue = (values.get("PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED") || "false").toLowerCase();
if (publicCmsCutoverValue !== "true" && publicCmsCutoverValue !== "false") {
  throw new Error("PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED must be exactly true or false.");
}
if (publicCmsCutoverValue === "true") {
  const gitEnvironment = { ...process.env };
  for (const key of Object.keys(gitEnvironment)) {
    if (key.startsWith("GIT_")) delete gitEnvironment[key];
  }
  let checkedOutRevision = "";
  try {
    checkedOutRevision = execFileSync(
      "git",
      ["-C", REPOSITORY_ROOT, "rev-parse", "--verify", "HEAD^{commit}"],
      { encoding: "utf8", env: gitEnvironment, timeout: 5_000 },
    ).trim().toLowerCase();
  } catch {
    throw new Error("Public CMS cutover requires a verifiable deployed Git revision.");
  }
  if ((values.get("PASTORWOOD_DEPLOYED_GIT_REVISION") || "").toLowerCase() !== checkedOutRevision) {
    throw new Error("Public CMS cutover attestation does not match the checked-out Git revision.");
  }
  const attestationEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    PASTORWOOD_CUTOVER_ATTESTATION_TEST_MODE: process.env.PASTORWOOD_CUTOVER_ATTESTATION_TEST_MODE,
    PASTORWOOD_CUTOVER_ATTESTATION_TEST_ROOT: process.env.PASTORWOOD_CUTOVER_ATTESTATION_TEST_ROOT,
    PASTORWOOD_CUTOVER_ATTESTATION_TEST_PATH: process.env.PASTORWOOD_CUTOVER_ATTESTATION_TEST_PATH,
    PASTORWOOD_CUTOVER_ATTESTATION_TEST_JSON: process.env.PASTORWOOD_CUTOVER_ATTESTATION_TEST_JSON,
    PASTORWOOD_CUTOVER_ATTESTATION_SHA256: values.get("PASTORWOOD_CUTOVER_ATTESTATION_SHA256"),
    PASTORWOOD_CUTOVER_PLAN_FINGERPRINT: values.get("PASTORWOOD_CUTOVER_PLAN_FINGERPRINT"),
    PASTORWOOD_CUTOVER_MUTATION_MANIFEST_SHA256: values.get("PASTORWOOD_CUTOVER_MUTATION_MANIFEST_SHA256"),
    PASTORWOOD_DEPLOYED_GIT_REVISION: values.get("PASTORWOOD_DEPLOYED_GIT_REVISION"),
  };
  const attestation = validatePastorWoodCutoverAttestation(attestationEnvironment);
  if (!attestation.ok) {
    throw new Error(`Public CMS cutover attestation is invalid: ${attestation.reason}`);
  }
}

const runtimeValue = (values.get("PASTORWOOD_SUBSCRIPTIONS_ENABLED") || "false").toLowerCase();
if (runtimeValue !== "true" && runtimeValue !== "false") {
  throw new Error("PASTORWOOD_SUBSCRIPTIONS_ENABLED must be exactly true or false.");
}
const runtimeEnabled = runtimeValue === "true";
const providerValuesPresent = PROVIDER_KEYS.every((key) => Boolean(values.get(key)?.trim()));
const providerReady = providerValuesPresent
  && /^[a-z0-9-]{2,24}$/.test((values.get("MAILCHIMP_SERVER_PREFIX") || "").toLowerCase())
  && /^[a-f0-9]{10,32}$/i.test(values.get("MAILCHIMP_AUDIENCE_ID") || "");

if (runtimeEnabled && !providerReady) {
  throw new Error("Public subscriptions cannot be enabled until the complete provider configuration is ready.");
}
if (runtimeEnabled && workerEnabled !== "1") {
  throw new Error("Public subscriptions cannot be enabled while the provider worker install toggle is disabled.");
}

console.log(JSON.stringify({
  launchStage,
  publicOrigin: launchStage === "development" ? "development" : "canonical",
  publicIndexing: indexingValue === "true" ? "enabled" : "disabled",
  publicCmsCutover: publicCmsCutoverValue === "true" ? "enabled" : "bootstrap",
  subscriptionRuntime: runtimeEnabled ? "enabled" : "disabled",
  subscriptionProvider: providerReady ? "ready" : "incomplete",
  subscriptionWorker: workerEnabled === "1" ? "enabled" : "disabled",
}));
