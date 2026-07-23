export type PastorWoodCutoverAttestationValidation =
  | { ok: true; attestation: Record<string, unknown> }
  | { ok: false; reason: string };

export const CANONICAL_CUTOVER_ATTESTATION_PATH: string;
export const CANONICAL_CUTOVER_ATTESTATION_ROOT: string;
export const CUTOVER_ATTESTATION_FILE_NAME: string;
export function validatePastorWoodCutoverAttestation(
  environment?: NodeJS.ProcessEnv,
): PastorWoodCutoverAttestationValidation;
export function resetPastorWoodCutoverAttestationCacheForTests(): void;
