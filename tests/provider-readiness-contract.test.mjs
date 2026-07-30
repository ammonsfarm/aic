import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function source(path) {
  return readFile(resolve(root, path), "utf8");
}

test("administrator readiness is guarded before provider or operational reads", async () => {
  const page = await source("app/(private)/admin/page.tsx");
  const guard = page.indexOf('await requireAdministrator("/overview")');
  assert.ok(guard >= 0);
  assert.ok(guard < page.indexOf("const settings = await getAdminSettings()"));
  assert.ok(guard < page.indexOf("getOperationalDashboard({ limit: 10 })"));
  assert.ok(guard < page.indexOf("getStrapiSiteSettings(),"));
  assert.match(page, /<ProviderReadiness items=\{readiness\} \/>/);
});

test("admin page has no contradictory current Podtrac authentication claim", async () => {
  const page = await source("app/(private)/admin/page.tsx");
  const readiness = await source("lib/provider-readiness.ts");
  assert.doesNotMatch(page, /Podtrac authentication:/);
  assert.doesNotMatch(page, /operations\.podtracAuth\.message/);
  assert.match(readiness, /can predate failures that occurred before a run row was inserted/);
  assert.match(readiness, /Current data \/ auth unverified/);
});

test("readiness uses a literal environment allowlist and renders key names only", async () => {
  const readiness = await source("lib/provider-readiness.ts");
  const component = await source("components/provider-readiness.tsx");
  assert.match(readiness, /export const PROVIDER_READINESS_ENV_KEYS = \{/);
  assert.match(readiness, /missingEnvironmentKeys/);
  assert.match(readiness, /invalidEnvironmentKeys/);
  assert.doesNotMatch(readiness, /Object\.(?:entries|values)\(process\.env\)/);
  assert.doesNotMatch(readiness, /\.\.\.process\.env/);
  assert.doesNotMatch(component, /process\.env/);
  assert.match(component, /never displays provider destinations/);
  assert.match(component, /entry\.state === "inactive" \? "Required before activation" : "Missing environment keys"/);
  assert.match(component, /Environment keys to review/);
  assert.match(component, /<code key=\{key\}>\{key\}<\/code>/);
});

test("backup readiness requires a host check instead of inferring configuration", async () => {
  const readiness = await source("lib/provider-readiness.ts");
  assert.match(readiness, /state: "host-check-required"/);
  assert.match(readiness, /Not verified from this surface\./);
  assert.match(readiness, /no trustworthy app-readable off-site replication success or freshness record/i);
  assert.doesNotMatch(readiness, /AIC_STRAPI_BACKUP_REPLICATION_ENABLED/);
});
