import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("publishing workflow includes site pages, site settings, and their audit destinations", async () => {
  const workflow = await source("app/(private)/content/workflow/page.tsx");
  const pageManagement = await source("lib/strapi-management.ts");

  assert.match(workflow, /getManagedStrapiPageSummary/);
  assert.match(workflow, /getManagedSiteSettings/);
  assert.match(workflow, /key: "site-pages"/);
  assert.match(workflow, /key: "site-settings"/);
  assert.match(workflow, /event\.entityType === "page"/);
  assert.match(workflow, /\/content\/site-pages\/\$\{encodeURIComponent\(event\.entityDocumentId\)\}/);
  assert.match(pageManagement, /filters\[archivedAt\]\[\$notNull\]/);
  assert.match(pageManagement, /filters\[archivedAt\]\[\$null\]/);
});
