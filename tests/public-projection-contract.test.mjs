import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, workflow, projection, privacy, pastorWoodPrivacy, signup, fixedPage, publicSite] = await Promise.all([
  readFile(new URL("../postgres/migrations/026_pastorwood_public_projection.sql", import.meta.url), "utf8"),
  readFile(new URL("../services/jimwood-cms/src/api/editorial-workflow/controllers/editorial-workflow.ts", import.meta.url), "utf8"),
  readFile(new URL("../services/jimwood-cms/src/api/editorial-workflow/controllers/public-projection.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/privacy-terms-conditions/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/devotional-signup-form.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/public-fixed-cms-page.ts", import.meta.url), "utf8"),
  readFile(new URL("../components/pastor-wood-site.tsx", import.meta.url), "utf8"),
]);

test("continuity tables live in the existing public schema and never create or select another database", () => {
  for (const table of [
    "public.pastorwood_public_projection",
    "public.pastorwood_public_projection_identities",
    "public.pastorwood_public_projection_media",
  ]) {
    assert.match(migration, new RegExp(table.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(migration, /\bcreate\s+database\b|\bconnect\s+to\b|\bdblink\b/i);
  assert.match(migration, /unique index[\s\S]*canonical_slug/i);
  assert.match(migration, /unique index[\s\S]*canonical_track_id/i);
  assert.match(migration, /unique index[\s\S]*page_key/i);
});

test("publish and scheduled publish update projection inside the exact editorial transaction", () => {
  assert.match(workflow, /strapi\.db\.transaction\(async \(\{ trx \}(?:: \{ trx: ProjectionTransaction \})?\) => \{/);
  assert.match(workflow, /callback\(trx as unknown as ProjectionTransaction\)/);
  const scheduled = workflow.slice(workflow.indexOf("if (action === 'publish-scheduled')"), workflow.indexOf("if (action === 'publish')"));
  assert.match(scheduled, /projectPublishedDocument\(trx, entityType, documentId, published\)/);
  const publish = workflow.slice(workflow.indexOf("if (action === 'publish')"), workflow.indexOf("if (action === 'retry-processing')"));
  assert.match(publish, /projectPublishedDocument\(trx, entityType, documentId, published\)/);
  for (const action of ["unpublish", "archive", "delete"]) {
    const start = workflow.indexOf(`if (action === '${action}')`);
    assert.notEqual(start, -1);
    assert.match(workflow.slice(start, workflow.indexOf("\n      if (action ===", start + 1) === -1 ? undefined : workflow.indexOf("\n      if (action ===", start + 1)), /tombstonePublicProjection\(trx/);
  }
  const rollback = workflow.slice(workflow.indexOf("if (action === 'rollback')"), workflow.indexOf("if (action === 'delete')"));
  assert.match(rollback, /if \(entityType === 'redirect'\) \{[\s\S]*?projectPublishedDocument\(trx/);
  assert.doesNotMatch(
    rollback.replace(/if \(entityType === 'redirect'\) \{[\s\S]*?\n        \}/, ""),
    /projectPublishedDocument\(trx/,
  );
});

test("projection payloads retain identities instead of populated draft relation bodies", () => {
  assert.match(projection, /authorDocumentId/);
  assert.match(projection, /guestDocumentIds/);
  assert.match(projection, /personDocumentId/);
  assert.match(projection, /pageDocumentId/);
  assert.match(projection, /identity is already owned by another published document/);
});

test("the exact /privacy route remains the GPT API policy while ministry privacy remains CMS-owned", () => {
  assert.match(privacy, /Privacy Policy for Pastor Wood Sermon Search GPT/);
  assert.doesNotMatch(privacy, /getPublicFixedCmsPage|PastorWoodContentPage/);
  assert.match(pastorWoodPrivacy, /getPublicFixedCmsPage\("privacy-terms-conditions"\)/);
  assert.match(pastorWoodPrivacy, /page="privacy"/);
});

test("devotional signup provides field-level errors, programmatic descriptions, and first-error focus", () => {
  assert.match(signup, /aria-invalid=\{Boolean\(fieldErrors\.email\)\}/);
  assert.match(signup, /aria-describedby=\{fieldErrors\.email/);
  assert.match(signup, /aria-invalid=\{Boolean\(fieldErrors\.consent\)\}/);
  assert.match(signup, /focusField\(validationErrors\.email \? "email" : "consent"\)/);
});

test("CMS-backed fixed routes and sitemap are evaluated at runtime after first-deploy provisioning", async () => {
  const runtimeRoutes = [
    "page.tsx",
    "about-pastor-wood/page.tsx",
    "abiding-in-christ/page.tsx",
    "board-members/page.tsx",
    "contact/page.tsx",
    "donate/page.tsx",
    "donor-dashboard/page.tsx",
    "endorsements/page.tsx",
    "privacy-terms-conditions/page.tsx",
    "sitemap.ts",
  ];
  for (const route of runtimeRoutes) {
    const source = await readFile(new URL(`../app/${route}`, import.meta.url), "utf8");
    assert.match(source, /export const dynamic = "force-dynamic";/, `${route} must not freeze a build-time fallback`);
  }
});

test("fixed pages preserve and disclose projection-backed continuity state", () => {
  assert.match(fixedPage, /continuityDegraded: result\.degraded === true/);
  assert.match(publicSite, /Showing the last published public version of this page/);
  assert.match(publicSite, /<PublicPageContinuityNotice cmsPage=\{cmsPage\} \/>/);
});
