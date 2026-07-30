import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("podcast chart labels distinguish not-loaded dates from genuine zero days", () => {
  const page = source("app/podcast/page.tsx");
  const episodes = source("app/podcast/episodes/page.tsx");
  const data = source("lib/podcast-data.ts");

  assert.match(page, /Not loaded/);
  assert.match(page, /excluded from totals and comparisons/);
  assert.match(page, /formatDownloads\(row\.downloads\)/);
  assert.match(page, /const x = padding\.left \+ \(rows\.length <= 1/);
  assert.doesNotMatch(page, /const point = points\[index\]/);
  assert.match(page, /No comparable loaded period is available/);
  assert.match(episodes, /trend-row--unavailable/);
  assert.match(episodes, /<strong>Not loaded<\/strong>/);
  assert.match(episodes, /No comparable loaded period is available/);
  assert.match(episodes, /row\.downloads === 0 \? "0%"/);
  assert.match(data, /when days\.activity_date > \$3::date then null/);
  assert.match(data, /row\.activity_date > dataCurrentThrough/);
});

test("Podtrac sync-to-import migration is nullable, idempotent, and one-to-one when linked", () => {
  const migration = source("postgres/migrations/029_podtrac_sync_attempt_truth.sql");

  assert.match(migration, /add column if not exists import_run_id integer;/);
  assert.doesNotMatch(migration, /add column if not exists import_run_id integer not null/);
  assert.match(migration, /if not exists \(\s*select 1\s*from pg_constraint/);
  assert.match(migration, /foreign key \(import_run_id\)\s*references podtrac_import_runs\(run_id\)\s*on delete set null/);
  assert.match(migration, /create unique index if not exists idx_podtrac_sync_runs_import_run/);
  assert.match(migration, /where import_run_id is not null;/);
});
