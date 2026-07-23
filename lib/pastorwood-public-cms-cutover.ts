import "server-only";

/**
 * One explicit operations gate controls when published Strapi/projection state
 * becomes authoritative on public PastorWood routes. It defaults off so Strapi
 * drafts can be prepared and reviewed without replacing bootstrap continuity.
 */
export function pastorWoodPublicCmsCutoverEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED?.trim().toLowerCase() === "true";
}
