import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function source(path) {
  return readFile(resolve(root, path), "utf8");
}

const realWorkflowRoutes = [
  "app/(private)/content/posts/page.tsx",
  "app/(private)/content/posts/new/page.tsx",
  "app/(private)/content/posts/[postId]/page.tsx",
  "app/(private)/content/podcast/page.tsx",
  "app/(private)/content/podcast/new/page.tsx",
  "app/(private)/content/podcast/[episodeId]/page.tsx",
  "app/(private)/content/media/(index)/page.tsx",
  "app/(private)/content/media/new/page.tsx",
  "app/(private)/content/media/[assetId]/page.tsx",
  "app/(private)/content/people/page.tsx",
  "app/(private)/content/endorsements/page.tsx",
  "app/(private)/content/redirects/page.tsx",
];

test("expected content-manager URLs resolve to structured workflows", async () => {
  for (const path of realWorkflowRoutes) {
    await stat(resolve(root, path));
    const contents = await source(path);
    assert.doesNotMatch(contents, /ContentManagementPlaceholder/);
    assert.match(contents, /Structured(Collection|NewEntry|EntryEditor)/);
  }
});

test("legacy page-manager URLs consolidate onto the Strapi page manager", async () => {
  assert.match(await source("app/(private)/content/pages/page.tsx"), /redirect\("\/content\/site-pages"\)/);
  assert.match(await source("app/(private)/content/pages/[pageId]/page.tsx"), /redirect\("\/content\/site-pages"\)/);
  assert.match(await source("lib/navigation.ts"), /href: "\/content\/site-pages"/);
  assert.doesNotMatch(await source("lib/navigation.ts"), /href: "\/content\/pages"/);
});

test("editor mutations are role guarded and cover the full lifecycle", async () => {
  const actions = await source("app/(private)/content/structured/actions.ts");
  assert.match(actions, /requireContentManagerApiUser/);
  for (const operation of [
    "createStructuredEntry",
    "updateStructuredEntry",
    "transitionStructuredEntry",
    "rollbackStructuredEntry",
    "deleteStructuredEntryAction",
  ]) {
    assert.match(actions, new RegExp(operation));
  }
  assert.match(actions, /Deletion confirmation must exactly match/);
  assert.match(actions, /currentTitle !== expectedTitle/);
  assert.match(actions, /confirmation,\n\s*\);/);
});

test("site pages use the same revisioned workflow and enforce immutable identity inside Strapi", async () => {
  const pageActions = await source("app/(private)/content/strapi-pages/actions.ts");
  for (const operation of [
    "createManagedStrapiPageWithWorkflow",
    "updateManagedStrapiPageWithWorkflow",
    "transitionManagedStrapiPage",
    "rollbackManagedStrapiPage",
    "deleteStrapiPageAction",
  ]) {
    assert.match(pageActions, new RegExp(operation));
  }
  assert.doesNotMatch(pageActions, /unpublishManagedStrapiPage/);

  const workflow = await source("services/jimwood-cms/src/api/editorial-workflow/controllers/editorial-workflow.ts");
  assert.match(workflow, /page: \{ uid: 'api::page\.page'/);
  assert.match(workflow, /Page identity cannot be changed after creation/);
  assert.match(workflow, /data\.pageKey = current\.pageKey/);
  assert.match(workflow, /strapi\.db\.transaction/);
  assert.match(workflow, /pg_advisory_xact_lock/);
  assert.match(workflow, /Archived content must be restored/);

  const lifecycle = await source("services/jimwood-cms/src/api/page/content-types/page/lifecycles.ts");
  assert.match(lifecycle, /beforeUpdate/);
  assert.match(lifecycle, /hasOwnProperty\.call\(data, 'pageKey'\)/);
  assert.match(lifecycle, /existing\?\.pageKey !== undefined/);
  assert.match(lifecycle, /ValidationError/);

  const actions = await source("app/(private)/content/strapi-pages/actions.ts");
  assert.match(actions, /page\.title !== expectedTitle/);
  assert.match(actions, /confirmation !== page\.title/);
  assert.match(actions, /confirmation,\n\s*\);/);

  const management = await source("lib/strapi-management.ts");
  assert.match(management, /expectedTitle \? \{ expectedTitle \}/);

  const publicPages = await source("lib/strapi.ts");
  assert.match(publicPages, /filters\[active\]\[\$eq\]/);
  assert.match(publicPages, /filters\[archivedAt\]\[\$null\]/);

  const pageManagement = await source("lib/strapi-management.ts");
  assert.match(pageManagement, /listManagedStrapiPagesPage/);
  assert.match(pageManagement, /filters\[slug\]\[\$eqi\]/);
  assert.match(pageManagement, /while \(true\)/);
  const pageInventory = await source("app/(private)/content/strapi-pages/page.tsx");
  assert.match(pageInventory, /role="search"/);
  assert.match(pageInventory, /pagination\.pageCount/);
  assert.match(pageInventory, /rel="next"/);
  const siteSettingsManagement = await source("lib/strapi-site-settings-management.ts");
  assert.match(siteSettingsManagement, /return listManagedStrapiPages\(\)/);
  assert.doesNotMatch(siteSettingsManagement, /pagination\[pageSize\].*100/);
});

test("media upload is bounded and private visibility is part of the editor contract", async () => {
  const actions = await source("app/(private)/content/structured/actions.ts");
  assert.match(actions, /MAX_IMAGE_BYTES/);
  assert.match(actions, /MAX_AUDIO_BYTES/);
  assert.match(actions, /BLOCKED_ACTIVE_CONTENT_TYPES/);
  const config = await source("lib/structured-content-config.ts");
  assert.match(config, /name: "visibility"/);
  assert.match(config, /options: \["private", "internal", "public"\]/);
  assert.match(config, /legacyAttachmentId/);
  const pageActions = await source("app/(private)/content/strapi-pages/actions.ts");
  assert.match(pageActions, /MAX_SECTION_IMAGE_BYTES/);
  assert.match(pageActions, /ALLOWED_SECTION_IMAGE_TYPES/);
  assert.doesNotMatch(pageActions, /image\/svg\+xml/);
});

test("public structured content is published-only, outage-safe, and visibility filtered", async () => {
  const adapter = await source("lib/strapi-structured-public.ts");
  assert.match(adapter, /query\.set\("status", "published"\)/);
  assert.match(adapter, /filters: \{ visibility: "public" \}/);
  assert.match(adapter, /catch \(error\)/);
  assert.doesNotMatch(adapter, /dangerouslySetInnerHTML/);

  for (const path of [
    "app/board-members/page.tsx",
    "app/endorsements/page.tsx",
    "app/bible-study/page.tsx",
    "app/written-resources/page.tsx",
    "app/radio/[[...slug]]/page.tsx",
  ]) {
    assert.match(await source(path), /PastorWoodStructured/);
  }
});

test("editor preview and revision rollback routes exist", async () => {
  await stat(resolve(root, "app/(private)/content/structured/[collection]/[documentId]/preview/page.tsx"));
  const editor = await source("app/(private)/content/structured/[collection]/[documentId]/page.tsx");
  assert.match(editor, /Revision history/);
  assert.match(editor, /rollbackStructuredEntryAction/);
  assert.match(editor, /Publish draft/);
  assert.match(editor, /Unpublish/);
  const preview = await source("app/(private)/content/structured/[collection]/[documentId]/preview/page.tsx");
  assert.match(preview, /sanitizeCmsHtml/);
  assert.match(preview, /field\.mediaTarget/);
  assert.match(preview, /\/api\/content\/strapi-media\//);
  assert.match(preview, /<audio controls/);
  assert.match(preview, /<img src=\{href\}/);
  assert.match(preview, /contentElement="div"/);
  assert.doesNotMatch(preview, /<main/);
  assert.doesNotMatch(preview, /whiteSpace: "pre-wrap" \}\>\{display\(entry\[field\.name\]\)\}/);
});

test("draft media preview is RBAC-gated and cannot become an arbitrary upstream proxy", async () => {
  const route = await source("app/api/content/strapi-media/[...path]/route.ts");
  assert.match(route, /requireContentManagerApiUser/);
  assert.match(route, /\/uploads\/\$\{parts\.map\(encodeURIComponent\)/);
  assert.match(route, /part !== "\.\."/);
  assert.match(route, /Cache-Control.*private, no-store/);
  assert.match(route, /Content-Security-Policy/);
  assert.match(route, /request\.headers\.get\("range"\)/);
  assert.match(route, /fetchWithTimeout/);
});

test("structured inventory uses server pagination and bounded search", async () => {
  const management = await source("lib/strapi-structured-management.ts");
  const inventory = await source("app/(private)/content/structured/[collection]/page.tsx");
  assert.match(management, /listStructuredEntriesPage/);
  assert.match(management, /pagination\[page\]/);
  assert.match(management, /\[\$containsi\]/);
  assert.match(management, /filters\[documentId\]\[\$in\]/);
  assert.match(management, /getStructuredInventorySummary/);
  assert.match(inventory, /pagination\.pageCount/);
  assert.match(inventory, /role="search"/);
  assert.match(inventory, /rel="next"/);

  const workflowDashboard = await source("app/(private)/content/workflow/page.tsx");
  assert.match(workflowDashboard, /getStructuredInventorySummary/);
  assert.doesNotMatch(workflowDashboard, /listStructuredEntries/);
});
