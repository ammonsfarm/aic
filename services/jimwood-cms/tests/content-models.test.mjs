import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function text(path) {
  return readFile(resolve(root, path), "utf8");
}

async function schema(apiName) {
  return JSON.parse(await text(`src/api/${apiName}/content-types/${apiName}/schema.json`));
}

const publicModels = {
  post: ["title", "slug", "contentType", "body", "archivedAt"],
  episode: ["title", "slug", "trackId", "audio", "externalAudioUrl", "archivedAt"],
  person: ["name", "slug", "showOnBoard", "active", "archivedAt"],
  endorsement: ["quote", "attribution", "active", "archivedAt"],
  "media-asset": ["title", "slug", "asset", "visibility", "legacyAttachmentId", "archivedAt"],
};

for (const [name, fields] of Object.entries(publicModels)) {
  test(`${name} is a draft-and-publish public content model`, async () => {
    const model = await schema(name);
    assert.equal(model.kind, "collectionType");
    assert.equal(model.options.draftAndPublish, true);
    for (const field of fields) {
      assert.ok(model.attributes[field], `${name} is missing ${field}`);
    }
  });
}

test("media is private by default and ties legacy imports to the attachment allowlist", async () => {
  const model = await schema("media-asset");
  assert.deepEqual(model.attributes.visibility.enum, ["private", "internal", "public"]);
  assert.equal(model.attributes.visibility.default, "private");
  assert.equal(model.attributes.legacyAttachmentId.unique, true);
});

test("redirects are an explicit non-draft registry", async () => {
  const model = await schema("redirect");
  assert.equal(model.options.draftAndPublish, false);
  assert.equal(model.attributes.fromPath.unique, true);
  assert.equal(model.attributes.statusCode.type, "integer");
  assert.equal(model.attributes.statusCode.default, 301);
});

test("episode identity is validated while pipeline state lives in the durable outbox", async () => {
  const episode = await schema("episode");
  assert.equal(episode.attributes.trackId.required, true);
  assert.equal(episode.attributes.trackId.unique, true);
  assert.match("sa_99151132260", new RegExp(episode.attributes.trackId.regex));
  assert.match("cms_sunday_20260722", new RegExp(episode.attributes.trackId.regex));
  for (const manualState of ["transcriptStatus", "intelligenceStatus", "vectorStatus"]) {
    assert.equal(episode.attributes[manualState], undefined);
  }
  const lifecycle = await text("src/api/episode/content-types/episode/lifecycles.ts");
  assert.match(lifecycle, /beforeUpdate/);
  assert.match(lifecycle, /publishedAt: \{ \$notNull: true \}/);
  assert.match(lifecycle, /episode-processing-request/);
  assert.match(lifecycle, /existing\.sourceFingerprint/);
  assert.match(lifecycle, /Track ID cannot change after an episode has been published/);

  const outbox = await schema("episode-processing-request");
  assert.equal(outbox.options.draftAndPublish, false);
  assert.equal(outbox.attributes.requestKey.unique, true);
  assert.deepEqual(outbox.attributes.status.enum, ["queued", "running", "completed", "failed", "superseded"]);
  assert.equal(outbox.attributes.forceReprocess.default, false);
  assert.equal(outbox.indexes[0].type, "unique");
});

test("revision and audit collections are append-only through API and database lifecycles", async () => {
  for (const name of ["editorial-revision", "editorial-event"]) {
    const model = await schema(name);
    assert.equal(model.options.draftAndPublish, false);
    const controller = await text(`src/api/${name}/controllers/${name}.ts`);
    assert.match(controller, /async update/);
    assert.match(controller, /async delete/);
    assert.match(controller, /immutable/);
    const lifecycle = await text(`src/api/${name}/content-types/${name}/lifecycles.ts`);
    for (const hook of ["beforeUpdate", "beforeUpdateMany", "beforeDelete", "beforeDeleteMany"]) {
      assert.match(lifecycle, new RegExp(hook));
    }
  }
  const revision = await schema("editorial-revision");
  assert.deepEqual(revision.indexes[0].columns, ["entity_type", "entity_document_id", "revision_number"]);
  assert.equal(revision.indexes[0].type, "unique");
  assert.ok(revision.attributes.entityType.enum.includes("site-setting"));
  assert.ok(revision.attributes.action.enum.includes("baseline"));
});

test("editorial workflow exposes create, update, transition, and revision reads", async () => {
  const routes = await text("src/api/editorial-workflow/routes/editorial-workflow.ts");
  assert.match(routes, /method: 'POST'[\s\S]*path: '\/editorial\/:entityType'/);
  assert.match(routes, /method: 'PUT'[\s\S]*:documentId/);
  assert.match(routes, /:documentId\/:action/);
  assert.match(routes, /:documentId\/revisions/);

  const controller = await text("src/api/editorial-workflow/controllers/editorial-workflow.ts");
  for (const action of ["publish", "unpublish", "archive", "restore", "rollback", "delete"]) {
    assert.match(controller, new RegExp(`action === '${action}'`));
  }
  assert.match(controller, /actorEmail/);
  assert.match(controller, /revisionNumber/);
  assert.match(controller, /strapi\.db\.transaction/);
  assert.match(controller, /pg_advisory_xact_lock/);
  assert.match(controller, /Archived content must be restored/);
  assert.match(controller, /expectedTitle !== currentTitle/);
  assert.match(controller, /Deletion confirmation no longer matches/);
  assert.match(controller, /snapshotForRevision/);
  assert.match(controller, /'site-setting'/);
  assert.match(controller, /api::site-setting\.site-setting/);
  assert.match(controller, /entityType === 'site-setting' \? 'singleton' : ''/);
  assert.match(controller, /strapi\.db\.query\(model\.uid as never\)\.findOne\(\)/);
  assert.match(controller, /Site settings have already been initialized\./);
  assert.match(controller, /action === 'baseline'/);
  assert.match(controller, /adoptedExisting: true/);
  assert.match(controller, /siteSettingsVersionMatches/);
  assert.match(controller, /atomic publication transition/);
  assert.match(controller, /enqueueEpisodeProcessing/);
  assert.match(controller, /hasPermanentEpisodeIdentity/);
  assert.match(controller, /data\.trackId = current\.trackId/);
  assert.match(controller, /requestKey: `\$\{documentId\}:revision:\$\{revisionNumber\}`/);
  assert.match(controller, /await recordAction[\s\S]*await enqueueEpisodeProcessing/);
  assert.doesNotMatch(controller, /DB_HOST|DB_PASSWORD|insert into episodes/i);
  const snapshot = await text("src/api/editorial-workflow/controllers/editorial-snapshot.ts");
  assert.match(snapshot, /writableDynamicZone/);
  assert.match(snapshot, /mediaReference/);
});

test("page identity remains a unique immutable-facing key in the content contract", async () => {
  const model = await schema("page");
  assert.equal(model.attributes.pageKey.required, true);
  assert.equal(model.attributes.pageKey.unique, true);
});

test("no runtime secret file is versioned in the service source", async () => {
  await assert.rejects(readFile(resolve(root, ".env"), "utf8"), { code: "ENOENT" });
  const example = await text(".env.example");
  assert.match(example, /replace-with-random-value/);
  assert.doesNotMatch(example, /sk-|eyJ[A-Za-z0-9_-]+\./);
});
