import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = (path) => readFileSync(join(root, path), "utf8");

test("canonical episode sync is executable, localhost-only, create-only, and draft-only", () => {
  const path = join(root, "scripts/sync_canonical_episode_drafts.py");
  const script = source("scripts/sync_canonical_episode_drafts.py");
  assert.notEqual(statSync(path).mode & 0o111, 0);
  assert.match(script, /CANONICAL_AIC_ENV/);
  assert.match(script, /http:\/\/127\.0\.0\.1:1337/);
  assert.match(script, /\/api\/editorial\/episode/);
  assert.doesNotMatch(script, /\/api\/editorial\/episode[^\n]*"PUT"/);
  assert.match(script, /published_matches/);
  assert.match(script, /created\.get\("publishedAt"\)/);
  assert.match(script, /"scheduledFor": None/);
  assert.match(script, /MAX_CREATES = 10/);
  assert.match(script, /MAX_SCAN_ROWS = 100/);
});

test("intelligence recovery pins canonical assets, required skip flags, and completion proof", () => {
  const path = join(root, "scripts/recover_failed_episode_intelligence.py");
  const script = source("scripts/recover_failed_episode_intelligence.py");
  assert.notEqual(statSync(path).mode & 0o111, 0);
  assert.match(script, /Path\("\/mnt\/storage\/podcasts"\)/);
  assert.match(script, /MINIO_ALIAS = "local-minio"/);
  assert.match(script, /MINIO_BUCKET = "aic"/);
  assert.match(script, /MINIO_PREFIX = "podcasts"/);
  assert.match(script, /"--skip-rss"/);
  assert.match(script, /"--skip-upload"/);
  assert.match(script, /"--skip-transcribe"/);
  assert.match(script, /"--skip-rag"/);
  assert.match(script, /i\.status in \('failed', 'rate_limited'\)/);
  assert.match(script, /v\.embedding is not null/);
  assert.match(script, /!= "completed"/);
  assert.match(script, /shell=False/);
  assert.doesNotMatch(script, /shell=True/);
  assert.match(script, /MAX_CANDIDATES = 4/);
  assert.match(script, /MAX_AUDIO_BYTES = 250 \* 1024 \* 1024/);
  assert.match(script, /size_bytes > MAX_AUDIO_BYTES/);
  assert.match(script, /MAX_RUNNER_ATTEMPTS = 1/);
});
