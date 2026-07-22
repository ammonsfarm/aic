import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("pipeline reconciliation exposes an audited unmatch control and complete event export", async () => {
  const page = await source("app/(private)/pipeline/page.tsx");
  const controls = await source("components/pipeline-operations.tsx");
  const operations = await source("lib/admin-operations.ts");
  const exportSource = await source("lib/podcast-export.ts");

  assert.match(page, /listMatchedPodtracEpisodes/);
  assert.match(controls, /Current Podtrac matches/);
  assert.match(controls, /trackId: null/);
  assert.match(controls, /Required audit note/);
  assert.match(operations, /podtracAuthenticationStatus\(podtracRows\[0\]\)/);
  assert.doesNotMatch(operations, /cron_podtrac_daily\.log/);
  for (const table of ["ingest_runs", "ingest_stage_events", "podtrac_sync_runs", "pipeline_retry_requests"]) {
    assert.match(exportSource, new RegExp(`from ${table}`));
  }
});
