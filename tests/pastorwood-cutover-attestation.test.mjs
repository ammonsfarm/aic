import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import attestationModule from "../lib/pastorwood-cutover-attestation.js";

process.env.NODE_ENV = "test";

const {
  CUTOVER_ATTESTATION_FILE_NAME,
  resetPastorWoodCutoverAttestationCacheForTests,
  validatePastorWoodCutoverAttestation,
} = attestationModule;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aic-cutover-attestation-"));
  const file = path.join(root, CUTOVER_ATTESTATION_FILE_NAME);
  const completedAt = "2026-07-23T00:00:02.000Z";
  const planFingerprint = "a".repeat(64);
  const mutationManifestSha256 = "b".repeat(64);
  const deployedGitRevision = "c".repeat(40);
  const actionsFingerprint = "d".repeat(64);
  const payload = {
    version: 1,
    planFingerprint,
    mutationManifestSha256,
    publication: {
      manifestSha256: "e".repeat(64),
      evidenceHash: "f".repeat(64),
      actionsFingerprint,
      expectedActionCount: 12,
      completedActionCount: 12,
      verified: true,
    },
    redirectActivation: {
      expectedCount: 4,
      activatedCount: 4,
      verifiedCount: 4,
      evidenceHash: "1".repeat(64),
      activatedLast: true,
      verified: true,
    },
    cacheInvalidation: {
      state: "complete",
      flushed: true,
      actionsFingerprint,
      completedAt: "2026-07-23T00:00:01.000Z",
    },
    deployedGitRevision,
    completedAt,
    failures: [],
  };
  const raw = `${JSON.stringify(payload, null, 2)}\n`;
  const sha256 = crypto.createHash("sha256").update(raw).digest("hex");
  fs.writeFileSync(file, raw, { mode: 0o600 });
  fs.writeFileSync(`${file}.sha256`, `${sha256}  ${CUTOVER_ATTESTATION_FILE_NAME}\n`, { mode: 0o600 });
  const environment = {
    NODE_ENV: "test",
    PASTORWOOD_CUTOVER_ATTESTATION_TEST_MODE: "1",
    PASTORWOOD_CUTOVER_ATTESTATION_TEST_ROOT: root,
    PASTORWOOD_CUTOVER_ATTESTATION_TEST_PATH: file,
    PASTORWOOD_CUTOVER_ATTESTATION_SHA256: sha256,
    PASTORWOOD_CUTOVER_PLAN_FINGERPRINT: planFingerprint,
    PASTORWOOD_CUTOVER_MUTATION_MANIFEST_SHA256: mutationManifestSha256,
    PASTORWOOD_DEPLOYED_GIT_REVISION: deployedGitRevision,
  };
  return { environment, file, payload, raw, root, sha256 };
}

function cleanup(item) {
  fs.rmSync(item.root, { recursive: true, force: true });
  resetPastorWoodCutoverAttestationCacheForTests();
}

test("complete exact attestation evidence validates and cached evidence notices later tampering", () => {
  const item = fixture();
  try {
    assert.equal(validatePastorWoodCutoverAttestation(item.environment).ok, true);
    assert.equal(validatePastorWoodCutoverAttestation(item.environment).ok, true);
    fs.writeFileSync(item.file, item.raw.replace(`"${"a".repeat(64)}"`, `"${"9".repeat(64)}"`));
    const tampered = validatePastorWoodCutoverAttestation(item.environment);
    assert.equal(tampered.ok, false);
    assert.match(tampered.reason, /SHA-256/);
  } finally {
    cleanup(item);
  }
});

test("missing, stale-plan, wrong-revision, and partial completion evidence fail closed", () => {
  const item = fixture();
  try {
    assert.equal(validatePastorWoodCutoverAttestation({
      ...item.environment,
      PASTORWOOD_CUTOVER_ATTESTATION_TEST_PATH: path.join(item.root, CUTOVER_ATTESTATION_FILE_NAME),
    }).ok, true);

    const stalePlan = validatePastorWoodCutoverAttestation({
      ...item.environment,
      PASTORWOOD_CUTOVER_PLAN_FINGERPRINT: "2".repeat(64),
    });
    assert.equal(stalePlan.ok, false);
    assert.match(stalePlan.reason, /plan fingerprint/);

    const wrongRevision = validatePastorWoodCutoverAttestation({
      ...item.environment,
      PASTORWOOD_DEPLOYED_GIT_REVISION: "3".repeat(40),
    });
    assert.equal(wrongRevision.ok, false);
    assert.match(wrongRevision.reason, /Git revision/);

    const staleMutation = validatePastorWoodCutoverAttestation({
      ...item.environment,
      PASTORWOOD_CUTOVER_MUTATION_MANIFEST_SHA256: "4".repeat(64),
    });
    assert.equal(staleMutation.ok, false);
    assert.match(staleMutation.reason, /mutation manifest/);

    const partial = { ...item.payload, publication: { ...item.payload.publication, completedActionCount: 11 } };
    const raw = `${JSON.stringify(partial, null, 2)}\n`;
    const sha = crypto.createHash("sha256").update(raw).digest("hex");
    fs.writeFileSync(item.file, raw);
    fs.writeFileSync(`${item.file}.sha256`, `${sha}  ${CUTOVER_ATTESTATION_FILE_NAME}\n`);
    const incomplete = validatePastorWoodCutoverAttestation({
      ...item.environment,
      PASTORWOOD_CUTOVER_ATTESTATION_SHA256: sha,
    });
    assert.equal(incomplete.ok, false);
    assert.match(incomplete.reason, /publication evidence/);

    fs.rmSync(item.file);
    assert.equal(validatePastorWoodCutoverAttestation(item.environment).ok, false);
  } finally {
    cleanup(item);
  }
});

test("partial redirect and cache invalidation evidence fail closed", () => {
  const item = fixture();
  try {
    for (const payload of [
      { ...item.payload, redirectActivation: { ...item.payload.redirectActivation, verifiedCount: 3 } },
      { ...item.payload, redirectActivation: { ...item.payload.redirectActivation, activatedLast: false } },
      { ...item.payload, cacheInvalidation: { ...item.payload.cacheInvalidation, state: "pending" } },
    ]) {
      const raw = `${JSON.stringify(payload, null, 2)}\n`;
      const sha = crypto.createHash("sha256").update(raw).digest("hex");
      fs.writeFileSync(item.file, raw);
      fs.writeFileSync(`${item.file}.sha256`, `${sha}  ${CUTOVER_ATTESTATION_FILE_NAME}\n`);
      assert.equal(validatePastorWoodCutoverAttestation({
        ...item.environment,
        PASTORWOOD_CUTOVER_ATTESTATION_SHA256: sha,
      }).ok, false);
    }
  } finally {
    cleanup(item);
  }
});

test("symlink and production test-path overrides are rejected", () => {
  const item = fixture();
  try {
    const target = path.join(item.root, "target.json");
    fs.renameSync(item.file, target);
    fs.symlinkSync(target, item.file);
    const symlink = validatePastorWoodCutoverAttestation(item.environment);
    assert.equal(symlink.ok, false);
    assert.match(symlink.reason, /regular file/);

    const productionOverride = validatePastorWoodCutoverAttestation({
      ...item.environment,
      NODE_ENV: "production",
    });
    assert.equal(productionOverride.ok, false);
    assert.match(productionOverride.reason, /forbidden outside tests/);
  } finally {
    cleanup(item);
  }
});
