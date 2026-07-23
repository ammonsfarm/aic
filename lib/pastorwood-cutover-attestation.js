/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS keeps this validator directly reusable by Next TypeScript and the pre-build Node ESM launch checker. */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CANONICAL_CUTOVER_ATTESTATION_ROOT = "/mnt/storage/pastorwood-migration-20260722";
const CANONICAL_CUTOVER_ATTESTATION_PATH = path.join(
  CANONICAL_CUTOVER_ATTESTATION_ROOT,
  "pastorwood-public-cms-cutover-attestation.json",
);
const CUTOVER_ATTESTATION_FILE_NAME = path.basename(CANONICAL_CUTOVER_ATTESTATION_PATH);
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[a-f0-9]{40}$/;
const MAX_ATTESTATION_BYTES = 64 * 1024;

let validationCache = null;

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validTimestamp(value) {
  return typeof value === "string"
    && value.length >= 20
    && Number.isFinite(Date.parse(value));
}

function exactValue(environment, key) {
  const value = environment[key];
  return typeof value === "string" ? value.trim() : "";
}

function invalid(reason) {
  return { ok: false, reason };
}

function testInjectionEnabled(environment) {
  return environment.NODE_ENV === "test"
    && exactValue(environment, "PASTORWOOD_CUTOVER_ATTESTATION_TEST_MODE") === "1";
}

function readNoFollow(filePath, expectedState) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  try {
    const openedState = fs.fstatSync(descriptor);
    if (
      !openedState.isFile()
      || openedState.dev !== expectedState.dev
      || openedState.ino !== expectedState.ino
    ) {
      throw new Error("Cutover attestation changed while it was being read.");
    }
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function readFileEvidence(environment) {
  const testMode = testInjectionEnabled(environment);
  const testJson = exactValue(environment, "PASTORWOOD_CUTOVER_ATTESTATION_TEST_JSON");
  if (testJson) {
    if (!testMode) throw new Error("Cutover attestation test evidence is forbidden outside tests.");
    return {
      bytes: Buffer.from(testJson, "utf8"),
      cacheIdentity: `test-json:${testJson}`,
      sidecarSha256: "",
    };
  }

  const testPath = exactValue(environment, "PASTORWOOD_CUTOVER_ATTESTATION_TEST_PATH");
  const testRoot = exactValue(environment, "PASTORWOOD_CUTOVER_ATTESTATION_TEST_ROOT");
  if (!testMode && (testPath || testRoot || exactValue(environment, "PASTORWOOD_CUTOVER_ATTESTATION_TEST_MODE"))) {
    throw new Error("Cutover attestation test paths are forbidden outside tests.");
  }

  let root = CANONICAL_CUTOVER_ATTESTATION_ROOT;
  let filePath = CANONICAL_CUTOVER_ATTESTATION_PATH;
  if (testMode) {
    if (!path.isAbsolute(testRoot) || !path.isAbsolute(testPath)) {
      throw new Error("Cutover attestation test paths must be absolute.");
    }
    root = path.resolve(testRoot);
    filePath = path.resolve(testPath);
    if (path.dirname(filePath) !== root || path.basename(filePath) !== CUTOVER_ATTESTATION_FILE_NAME) {
      throw new Error("Cutover attestation test evidence must use the canonical filename directly under its test root.");
    }
  }

  const rootState = fs.lstatSync(root);
  if (!rootState.isDirectory() || rootState.isSymbolicLink()) {
    throw new Error("Cutover attestation root is not a real directory.");
  }
  const fileState = fs.lstatSync(filePath);
  if (!fileState.isFile() || fileState.isSymbolicLink() || fileState.size < 2 || fileState.size > MAX_ATTESTATION_BYTES) {
    throw new Error("Cutover attestation is not a safe regular file.");
  }
  const checksumPath = `${filePath}.sha256`;
  const checksumState = fs.lstatSync(checksumPath);
  if (!checksumState.isFile() || checksumState.isSymbolicLink() || checksumState.size > 256) {
    throw new Error("Cutover attestation checksum is not a safe regular file.");
  }

  const bytes = readNoFollow(filePath, fileState);
  const checksumBytes = readNoFollow(checksumPath, checksumState);
  const checksumLine = checksumBytes.toString("utf8");
  const checksumMatch = checksumLine.match(/^([a-f0-9]{64})  ([^\r\n]+)\r?\n$/);
  if (!checksumMatch || checksumMatch[2] !== CUTOVER_ATTESTATION_FILE_NAME) {
    throw new Error("Cutover attestation checksum evidence is invalid.");
  }
  return {
    bytes,
    sidecarSha256: checksumMatch[1],
    cacheIdentity: [
      filePath,
      fileState.dev,
      fileState.ino,
      fileState.size,
      fileState.mtimeMs,
      fileState.ctimeMs,
      checksumState.dev,
      checksumState.ino,
      checksumState.size,
      checksumState.mtimeMs,
      checksumState.ctimeMs,
    ].join(":"),
  };
}

function validateSchema(attestation, expected) {
  if (!plainObject(attestation) || attestation.version !== 1) {
    return invalid("Cutover attestation version is invalid.");
  }
  if (attestation.planFingerprint !== expected.planFingerprint) {
    return invalid("Cutover attestation does not match the reviewed plan fingerprint.");
  }
  if (attestation.mutationManifestSha256 !== expected.mutationManifestSha256) {
    return invalid("Cutover attestation does not match the reviewed mutation manifest.");
  }
  if (attestation.deployedGitRevision !== expected.deployedGitRevision) {
    return invalid("Cutover attestation does not match the deployed Git revision.");
  }
  if (!validTimestamp(attestation.completedAt)) {
    return invalid("Cutover attestation completion time is invalid.");
  }
  if (!Array.isArray(attestation.failures) || attestation.failures.length !== 0) {
    return invalid("Cutover attestation contains failure evidence.");
  }

  const publication = attestation.publication;
  if (
    !plainObject(publication)
    || publication.verified !== true
    || !HASH_PATTERN.test(publication.manifestSha256 || "")
    || !HASH_PATTERN.test(publication.evidenceHash || "")
    || !HASH_PATTERN.test(publication.actionsFingerprint || "")
    || !Number.isInteger(publication.expectedActionCount)
    || publication.expectedActionCount < 0
    || publication.completedActionCount !== publication.expectedActionCount
  ) {
    return invalid("Cutover publication evidence is incomplete or invalid.");
  }

  const redirects = attestation.redirectActivation;
  if (
    !plainObject(redirects)
    || redirects.activatedLast !== true
    || redirects.verified !== true
    || !HASH_PATTERN.test(redirects.evidenceHash || "")
    || !Number.isInteger(redirects.expectedCount)
    || redirects.expectedCount < 0
    || redirects.activatedCount !== redirects.expectedCount
    || redirects.verifiedCount !== redirects.expectedCount
  ) {
    return invalid("Cutover redirect activation evidence is incomplete or invalid.");
  }

  const invalidation = attestation.cacheInvalidation;
  if (
    !plainObject(invalidation)
    || invalidation.state !== "complete"
    || invalidation.flushed !== true
    || invalidation.actionsFingerprint !== publication.actionsFingerprint
    || !HASH_PATTERN.test(invalidation.actionsFingerprint || "")
    || !validTimestamp(invalidation.completedAt)
    || Date.parse(invalidation.completedAt) > Date.parse(attestation.completedAt)
  ) {
    return invalid("Cutover cache invalidation evidence is incomplete or invalid.");
  }
  return { ok: true, attestation };
}

function validatePastorWoodCutoverAttestation(environment = process.env) {
  const expected = {
    sha256: exactValue(environment, "PASTORWOOD_CUTOVER_ATTESTATION_SHA256").toLowerCase(),
    planFingerprint: exactValue(environment, "PASTORWOOD_CUTOVER_PLAN_FINGERPRINT").toLowerCase(),
    mutationManifestSha256: exactValue(environment, "PASTORWOOD_CUTOVER_MUTATION_MANIFEST_SHA256").toLowerCase(),
    deployedGitRevision: exactValue(environment, "PASTORWOOD_DEPLOYED_GIT_REVISION").toLowerCase(),
  };
  if (!HASH_PATTERN.test(expected.sha256)) return invalid("Cutover attestation SHA-256 is not configured.");
  if (!HASH_PATTERN.test(expected.planFingerprint)) return invalid("Reviewed cutover plan fingerprint is not configured.");
  if (!HASH_PATTERN.test(expected.mutationManifestSha256)) return invalid("Reviewed mutation manifest SHA-256 is not configured.");
  if (!REVISION_PATTERN.test(expected.deployedGitRevision)) return invalid("Deployed Git revision is not configured.");

  let evidence;
  try {
    evidence = readFileEvidence(environment);
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Cutover attestation could not be read.");
  }
  const cacheKey = [
    expected.sha256,
    expected.planFingerprint,
    expected.mutationManifestSha256,
    expected.deployedGitRevision,
    evidence.cacheIdentity,
  ].join("|");
  if (validationCache?.key === cacheKey) return validationCache.result;

  const actualSha256 = crypto.createHash("sha256").update(evidence.bytes).digest("hex");
  if (actualSha256 !== expected.sha256 || (evidence.sidecarSha256 && evidence.sidecarSha256 !== actualSha256)) {
    const result = invalid("Cutover attestation SHA-256 does not match its bound evidence.");
    validationCache = { key: cacheKey, result };
    return result;
  }
  let attestation;
  try {
    attestation = JSON.parse(evidence.bytes.toString("utf8"));
  } catch {
    const result = invalid("Cutover attestation JSON is invalid.");
    validationCache = { key: cacheKey, result };
    return result;
  }
  const result = validateSchema(attestation, expected);
  validationCache = { key: cacheKey, result };
  return result;
}

function resetPastorWoodCutoverAttestationCacheForTests() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Cutover attestation cache reset is test-only.");
  }
  validationCache = null;
}

module.exports = {
  CANONICAL_CUTOVER_ATTESTATION_PATH,
  CANONICAL_CUTOVER_ATTESTATION_ROOT,
  CUTOVER_ATTESTATION_FILE_NAME,
  resetPastorWoodCutoverAttestationCacheForTests,
  validatePastorWoodCutoverAttestation,
};
