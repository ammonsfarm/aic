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
});

test("media upload is bounded and private visibility is part of the editor contract", async () => {
  const actions = await source("app/(private)/content/structured/actions.ts");
  assert.match(actions, /MAX_IMAGE_BYTES/);
  assert.match(actions, /MAX_AUDIO_BYTES/);
  const config = await source("lib/structured-content-config.ts");
  assert.match(config, /name: "visibility"/);
  assert.match(config, /options: \["private", "internal", "public"\]/);
  assert.match(config, /legacyAttachmentId/);
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
});
