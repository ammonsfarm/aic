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
  assert.match(actions, /revalidateTag/);
  assert.match(actions, /STRAPI_PUBLIC_MEDIA_CACHE_TAG/);
  assert.match(actions, /strapiStructuredCacheTag\(key\)/);
  assert.match(actions, /revalidatePath\("\/sitemap\.xml"\)/);
  assert.match(actions, /currentTitle !== expectedTitle/);
  assert.match(actions, /confirmation,\n\s*\);/);
});

test("redirect edits reject external, reserved, and self-referential targets", async () => {
  const actions = await source("app/(private)/content/structured/actions.ts");
  assert.match(actions, /isReservedLegacyRedirectSource/);
  assert.match(actions, /isSafeLegacyRedirectTarget/);
  assert.match(actions, /Redirect destination must be a non-reserved path on this site/);
  assert.match(actions, /A redirect cannot point to itself/);
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
  assert.match(workflow, /page:\s*\{[\s\S]{0,160}?uid: 'api::page\.page'/);
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
  assert.match(publicPages, /populate\[socialImage\]/);

  const pageSchema = JSON.parse(await source("services/jimwood-cms/src/api/page/content-types/page/schema.json"));
  assert.equal(pageSchema.attributes.noIndex.type, "boolean");
  assert.equal(pageSchema.attributes.socialImage.type, "media");
  assert.deepEqual(pageSchema.attributes.socialImage.allowedTypes, ["images"]);
  for (const field of ["canonicalUrl", "noIndex", "socialImage"]) {
    assert.match(pageActions, new RegExp(field));
    assert.match(await source("lib/strapi-management.ts"), new RegExp(field));
  }
  const publicSeo = await source("lib/public-seo.ts");
  assert.match(publicSeo, /canonicalUrl: page\?\.canonicalUrl/);
  assert.match(publicSeo, /imageUrl: page\?\.socialImage\?\.url/);
  assert.match(publicSeo, /noIndex: page\?\.noIndex/);

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

test("all editorial mutations carry a version and editors warn before discarding changes", async () => {
  const workflow = await source("services/jimwood-cms/src/api/editorial-workflow/controllers/editorial-workflow.ts");
  assert.match(workflow, /function versionMatches/);
  assert.match(workflow, /This content item.*changed after this editor was loaded/);

  for (const path of [
    "lib/strapi-management.ts",
    "lib/strapi-structured-management.ts",
    "app/(private)/content/strapi-pages/actions.ts",
    "app/(private)/content/structured/actions.ts",
  ]) {
    assert.match(await source(path), /expectedUpdatedAt/);
  }

  for (const path of [
    "app/(private)/content/strapi-pages/page-editor-client.tsx",
    "components/structured-content-form.tsx",
  ]) {
    const editor = await source(path);
    assert.match(editor, /beforeunload/);
    assert.match(editor, /You have unsaved changes/);
    assert.match(editor, /aria-live="polite"/);
    assert.match(editor, /addEventListener\("submit", confirmSiblingSubmission, true\)/);
    assert.match(editor, /isSiblingEditorForm\(event\.target, formRef\.current\)/);
    assert.match(editor, /stopImmediatePropagation/);
  }
});

test("custom editors expose the structured fields already present in Strapi", async () => {
  const config = await source("lib/structured-content-config.ts");
  for (const field of ["author", "guests", "person", "scriptureReferences", "relatedLinks", "seo"]) {
    assert.match(config, new RegExp(`name: "${field}"`));
  }
  assert.match(config, /type: "relation"/);
  assert.match(config, /type: "scripture"/);
  assert.match(config, /type: "external-links"/);
  assert.match(config, /type: "seo"/);

  const form = await source("components/structured-content-form.tsx");
  assert.match(form, /multiple=\{field\.multiple\}/);
  assert.match(form, /Search description/);
  assert.match(form, /scriptureValue/);
  assert.match(form, /socialImageFile/);
  assert.match(form, /Leave empty to preserve it/);

  const actions = await source("app/(private)/content/structured/actions.ts");
  assert.match(actions, /return \{ set: field\.multiple \? documentIds : documentIds\.slice\(0, 1\) \}/);
  assert.match(actions, /delimitedLines/);
  assert.match(actions, /canonical URL/);
  assert.match(actions, /structuredSeoPayload/);
  assert.match(actions, /existingEntry/);

  const management = await source("lib/strapi-structured-management.ts");
  assert.match(management, /listStructuredPeopleOptions/);
  assert.match(management, /1,000-item editor safety bound/);
});

test("scheduled publication is bounded, versioned, and timer driven", async () => {
  const workflow = await source("services/jimwood-cms/src/api/editorial-workflow/controllers/editorial-workflow.ts");
  assert.match(workflow, /action === 'publish-scheduled'/);
  assert.match(workflow, /scheduledAt > Date\.now\(\)/);
  assert.match(workflow, /scheduledFor: null/);
  assert.match(workflow, /\{ scheduled: true, scheduledFor \}/);
  assert.match(workflow, /EDITORIAL_MISSING_PUBLIC_AUDIO/);

  const worker = await source("scripts/publish_scheduled_strapi_content.mjs");
  assert.match(worker, /safeLimit/);
  assert.match(worker, /expectedUpdatedAt/);
  assert.match(worker, /system:scheduled-publication/);
  assert.match(worker, /IDEMPOTENT_SKIP_CODES/);
  assert.match(worker, /UNCLASSIFIED_HTTP_ERROR/);
  assert.match(worker, /CANONICAL_AIC_ENV = "\/mnt\/storage\/aic\/\.env"/);
  assert.match(worker, /canonicalValues\.STRAPI_REVALIDATE_SECRET/);
  assert.doesNotMatch(worker, /process\.env\.STRAPI_(?:URL|MANAGEMENT_URL|API_TOKEN|MANAGEMENT_TOKEN|REVALIDATE_SECRET)/);
  assert.doesNotMatch(worker, /DB_HOST|DB_PASSWORD|postgres/i);

  const invalidation = await source("scripts/public_cache_invalidation.mjs");
  assert.match(invalidation, /http:\/\/127\.0\.0\.1:8087\/api\/revalidate\/strapi/);
  assert.doesNotMatch(invalidation, /STRAPI_REVALIDATE_URL|process\.env/);
  assert.match(invalidation, /event: "entry\.publish"/);
  assert.match(invalidation, /payload\?\.revalidated !== true/);
  assert.match(invalidation, /handle\.sync\(\)/);
  assert.match(invalidation, /syncDirectory\(directory\)/);
  assert.match(invalidation, /O_NOFOLLOW/);
  assert.match(invalidation, /\/usr\/bin\/flock --exclusive 3/);
  const markIndex = worker.indexOf("markPublicCacheInvalidationPending");
  const publishRequestIndex = worker.indexOf("await jsonRequest(", worker.indexOf("for (const entry of entries"));
  assert.ok(markIndex >= 0 && publishRequestIndex > markIndex);

  await stat(resolve(root, "systemd/aic-scheduled-publication-worker.service"));
  await stat(resolve(root, "systemd/aic-scheduled-publication-worker.timer"));
  const service = await source("systemd/aic-scheduled-publication-worker.service");
  assert.match(service, /TimeoutStartSec=10m/);
  assert.match(service, /StateDirectory=aic-scheduled-publication/);
  assert.match(service, /StateDirectoryMode=0700/);
  assert.match(service, /ReadWritePaths=\/var\/lib\/aic-scheduled-publication/);
  assert.match(await source("scripts/deploy-farm-web.sh"), /install-scheduled-publication-worker\.sh/);
  assert.doesNotMatch(await source("scripts/deploy-farm-web.sh"), /restore-drill|RUN_STRAPI_BACKUP_DRILL/);
});

test("public-form retention runs independently of new submissions", async () => {
  const [worker, subscriptionIndexMigration, migration, deploy, service, timer] = await Promise.all([
    source("scripts/cleanup_public_data_retention.py"),
    source("postgres/migrations/021_public_subscription_attempt_retention.sql"),
    source("postgres/migrations/027_public_data_retention.sql"),
    source("scripts/deploy-farm-web.sh"),
    source("systemd/aic-public-data-retention-worker.service"),
    source("systemd/aic-public-data-retention-worker.timer"),
  ]);
  for (const table of ["public_subscription_attempts", "public_contact_attempts", "public_contact_messages"]) {
    assert.match(worker, new RegExp(table));
  }
  assert.match(worker, /status = 'archived'/);
  assert.match(worker, /for update skip locked/i);
  assert.match(worker, /limit %s/i);
  assert.match(worker, /load_canonical_aic_env/);
  assert.match(worker, /database_dsn/);
  assert.doesNotMatch(worker, /docker|sqlite|create database|drop database/i);
  assert.match(subscriptionIndexMigration, /idx_public_subscription_attempts_created/);
  assert.match(subscriptionIndexMigration, /on public_subscription_attempts\(created_at asc, id asc\)/);
  assert.match(migration, /where status = 'archived'/);
  assert.match(migration, /updated_at asc, id asc/);
  assert.match(service, /cleanup_public_data_retention\.py --env-file \/mnt\/storage\/aic\/\.env/);
  assert.match(timer, /OnUnitActiveSec=1h/);
  assert.match(timer, /Description=.*hourly/);
  assert.match(timer, /Persistent=true/);
  assert.match(deploy, /install-public-data-retention-worker\.sh/);
  assert.match(deploy, /aic-public-data-retention-worker\.timer/);
});

test("global site settings use attributed revisions, rollback, and an idempotent first-install path", async () => {
  const actions = await source("app/(private)/content/site-settings/actions.ts");
  for (const operation of [
    "createManagedSiteSettingsWithWorkflow",
    "updateManagedSiteSettingsWithWorkflow",
    "saveAndTransitionManagedSiteSettings",
    "rollbackManagedSiteSettings",
    "requireContentManagerApiUser",
  ]) {
    assert.match(actions, new RegExp(operation));
  }
  assert.doesNotMatch(actions, /unpublishManagedSiteSettings/);
  assert.match(actions, /MAX_HEADER_LOGO_BYTES/);
  assert.match(actions, /subscriptionEnabled/);
  assert.match(actions, /expectedUpdatedAt/);
  assert.match(actions, /cleanupRejectedHeaderLogo/);
  assert.match(actions, /deleteStructuredFile/);
  const saveAction = actions.slice(actions.indexOf("export async function saveSiteSettingsAction"));
  assert.ok(
    saveAction.indexOf("Unsupported site-settings publication action") < saveAction.indexOf("await parseSiteSettingsInput"),
    "publication actions must be validated before an upload can occur",
  );

  const management = await source("lib/strapi-site-settings-management.ts");
  assert.match(management, /\/api\/editorial\/site-setting/);
  assert.match(management, /listManagedSiteSettingsRevisions/);
  assert.match(management, /headerLogoId/);
  assert.match(management, /subscriptionEnabled/);
  assert.match(management, /relationValue: documentId \|\| id/);

  const editor = await source("app/(private)/content/site-settings/page.tsx");
  assert.match(editor, /Initialize site settings/);
  assert.match(editor, /Revision history/);
  assert.match(editor, /rollbackSiteSettingsAction/);
  assert.match(editor, /headerLogoFile/);
  assert.match(editor, /subscriptionEnabled/);
  assert.match(editor, /name="expectedUpdatedAt"/);
  assert.match(editor, /value=\{page\.documentId\}/);
  assert.doesNotMatch(editor, /value=\{page\.id \?\? page\.documentId\}/);

  const workflow = await source("services/jimwood-cms/src/api/editorial-workflow/controllers/editorial-workflow.ts");
  assert.match(workflow, /'site-setting':/);
  assert.match(workflow, /api::site-setting\.site-setting/);
  assert.match(workflow, /entityType === 'site-setting' \? 'singleton' : ''/);
  assert.match(workflow, /strapi\.db\.query\(model\.uid as never\)\.findOne\(\)/);
  assert.match(workflow, /Site settings have already been initialized\./);
  assert.match(workflow, /action === 'baseline'/);
  assert.match(workflow, /adoptedExisting: true/);
  assert.match(workflow, /Site settings changed after this editor was loaded/);
  assert.match(workflow, /Site settings data is required for an atomic publication transition/);
  const revisions = JSON.parse(await source("services/jimwood-cms/src/api/editorial-revision/content-types/editorial-revision/schema.json"));
  assert.ok(revisions.attributes.entityType.enum.includes("site-setting"));
  assert.ok(revisions.attributes.action.enum.includes("baseline"));

  const seed = await source("scripts/seed-strapi-site-settings.mjs");
  assert.match(seed, /site-settings-baseline-adopted/);
  assert.match(seed, /site-settings-already-audited/);
  assert.match(seed, /\/baseline/);
  assert.match(seed, /findPageDocumentId/);
  assert.match(seed, /payload\.data\?\.\[0\]\?\.documentId/);
  assert.match(seed, /\/api\/editorial\/site-setting/);
  assert.match(await source("scripts/deploy-farm-web.sh"), /seed-strapi-site-settings\.mjs/);

  const listings = await source("components/pastor-wood-structured-listings.tsx");
  assert.match(listings, /showDevotionalSignup: mode === "devotional"/);
  assert.match(listings, /showDevotionalSignup && settings\?\.subscriptionEnabled === true/);
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

  const management = await source("lib/strapi-structured-management.ts");
  assert.match(management, /listReusableMediaOptions/);
  assert.match(management, /filters\[visibility\]\[\$eq\].*public/);
  assert.match(management, /assertReusableMediaSelection/);
  const form = await source("components/structured-content-form.tsx");
  assert.match(form, /LibraryId/);
  assert.match(form, /Use existing public media/);
  assert.match(actions, /must use either an existing media item or a new upload/);
  assert.match(pageActions, /Choose either an existing section image or a new upload/);
});

test("episode publication uses a durable outbox and read-only processing status", async () => {
  const workflow = await source("services/jimwood-cms/src/api/editorial-workflow/controllers/editorial-workflow.ts");
  assert.match(workflow, /processingRequestUid/);
  assert.match(workflow, /requestKey: `\$\{documentId\}:revision:\$\{revisionNumber\}`/);
  assert.match(workflow, /status: 'queued'/);
  assert.match(workflow, /status: \{ \$in: \['queued', 'running', 'failed'\] \}/);
  assert.match(workflow, /status: 'superseded'/);
  assert.match(workflow, /action === 'retry-processing'/);
  assert.match(workflow, /A processing retry note is required/);
  assert.match(workflow, /Track ID cannot change after an episode has been published/);
  assert.doesNotMatch(workflow, /DB_HOST|DB_PASSWORD|insert into episodes/i);

  const config = await source("lib/structured-content-config.ts");
  for (const manualState of ["transcriptStatus", "intelligenceStatus", "vectorStatus"]) {
    assert.doesNotMatch(config, new RegExp(`name: "${manualState}"`));
  }
  assert.match(config, /Permanent processing identity/);

  const editor = await source("app/(private)/content/structured/[collection]/[documentId]/page.tsx");
  assert.match(editor, /Publication processing/);
  assert.match(editor, /processing\.status === "queued"/);
  assert.match(editor, /processing\.status === "running"/);
  assert.match(editor, /processing\.status === "completed"/);
  assert.match(editor, /processing\.status === "failed"/);
  assert.match(editor, /Queue processing retry/);

  const deploy = await source("scripts/deploy-farm-web.sh");
  assert.match(deploy, /install-episode-publish-worker\.sh/);
  const worker = await source("scripts/process_episode_publish_requests.py");
  assert.match(worker, /autocommit=True/);
  assert.match(worker, /episode_processing_ownership/);
  assert.match(worker, /episode_processing_provenance/);
  assert.match(worker, /ensure_request_current/);
  assert.match(worker, /transition_request/);
  assert.match(worker, /worker-transition/);
  assert.match(worker, /matching_complete_provenance/);
  assert.match(worker, /--mistral-max-file-mb/);
  assert.match(worker, /--retranscribe/);
  const transition = await source("services/jimwood-cms/src/api/episode-processing-request/controllers/episode-processing-request.ts");
  assert.match(transition, /strapi\.db\.transaction/);
  assert.match(transition, /pg_advisory_xact_lock/);
  assert.match(transition, /current\?\.status === 'running'/);
  assert.match(transition, /current\.workerId === input\.workerId/);
  assert.match(transition, /newest\?\.documentId === documentId/);
  const migration = await source("postgres/migrations/022_episode_processing_provenance.sql");
  assert.match(migration, /create table if not exists episode_processing_ownership/);
  assert.match(migration, /episode_document_id text not null unique/);
  assert.match(migration, /references episode_processing_ownership\(track_id, episode_document_id\)/);
  await stat(resolve(root, "systemd/aic-episode-publish-worker.service"));
  await stat(resolve(root, "systemd/aic-episode-publish-worker.timer"));
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
  assert.match(preview, /\/api\/content\/strapi-media\//);
  assert.match(preview, /<audio controls/);
  assert.match(preview, /PublicLayoutPreview/);
  assert.match(preview, /pw-board-grid/);
  assert.match(preview, /pw-endorsement-grid/);
  assert.match(preview, /pw-audio-list/);
  assert.match(preview, /pw-writing-detail/);
  assert.doesNotMatch(preview, /definition\.fields\.map/);
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
