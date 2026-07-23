import "server-only";

import { createHash } from "node:crypto";

import {
  resetPastorWoodCutoverAttestationCacheForTests,
  validatePastorWoodCutoverAttestation,
} from "@/lib/pastorwood-cutover-attestation.js";

const TEST_ATTESTATION_KEYS = [
  "PASTORWOOD_CUTOVER_ATTESTATION_SHA256",
  "PASTORWOOD_CUTOVER_PLAN_FINGERPRINT",
  "PASTORWOOD_CUTOVER_MUTATION_MANIFEST_SHA256",
  "PASTORWOOD_DEPLOYED_GIT_REVISION",
  "PASTORWOOD_CUTOVER_ATTESTATION_TEST_MODE",
  "PASTORWOOD_CUTOVER_ATTESTATION_TEST_JSON",
] as const;

/**
 * One explicit operations gate controls when published Strapi/projection state
 * becomes authoritative on public PastorWood routes. It defaults off so Strapi
 * drafts can be prepared and reviewed without replacing bootstrap continuity.
 */
export function pastorWoodPublicCmsCutoverEnabled(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED?.trim().toLowerCase() !== "true") return false;
  return validatePastorWoodCutoverAttestation(environment).ok;
}

/**
 * Explicitly installs complete in-memory evidence for tests that exercise the
 * post-cutover path. Production cannot enter this lane because the validator
 * requires NODE_ENV=test as well as the test-only mode marker.
 */
export function enablePastorWoodPublicCmsCutoverForTests(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.NODE_ENV !== "test") throw new Error("PastorWood cutover test evidence is test-only.");
  const completedAt = "2026-07-23T00:00:00.000Z";
  const planFingerprint = "2".repeat(64);
  const mutationManifestSha256 = "3".repeat(64);
  const deployedGitRevision = "4".repeat(40);
  const actionsFingerprint = "5".repeat(64);
  const attestation = {
    version: 1,
    planFingerprint,
    mutationManifestSha256,
    publication: {
      manifestSha256: "6".repeat(64),
      evidenceHash: "7".repeat(64),
      actionsFingerprint,
      expectedActionCount: 2,
      completedActionCount: 2,
      verified: true,
    },
    redirectActivation: {
      expectedCount: 1,
      activatedCount: 1,
      verifiedCount: 1,
      evidenceHash: "8".repeat(64),
      activatedLast: true,
      verified: true,
    },
    cacheInvalidation: {
      state: "complete",
      flushed: true,
      actionsFingerprint,
      completedAt,
    },
    deployedGitRevision,
    completedAt,
    failures: [],
  };
  const raw = JSON.stringify(attestation);
  Object.assign(environment, {
    PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED: "true",
    PASTORWOOD_CUTOVER_ATTESTATION_SHA256: createHash("sha256").update(raw).digest("hex"),
    PASTORWOOD_CUTOVER_PLAN_FINGERPRINT: planFingerprint,
    PASTORWOOD_CUTOVER_MUTATION_MANIFEST_SHA256: mutationManifestSha256,
    PASTORWOOD_DEPLOYED_GIT_REVISION: deployedGitRevision,
    PASTORWOOD_CUTOVER_ATTESTATION_TEST_MODE: "1",
    PASTORWOOD_CUTOVER_ATTESTATION_TEST_JSON: raw,
  });
  resetPastorWoodCutoverAttestationCacheForTests();
}

export function disablePastorWoodPublicCmsCutoverForTests(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.NODE_ENV !== "test") throw new Error("PastorWood cutover test evidence is test-only.");
  delete environment.PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED;
  for (const key of TEST_ATTESTATION_KEYS) delete environment[key];
  resetPastorWoodCutoverAttestationCacheForTests();
}
