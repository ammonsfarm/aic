import assert from "node:assert/strict";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = (path) => readFileSync(join(root, path), "utf8");

test("scheduled worker installer and exact cron migration scripts are executable and valid", () => {
  for (const relative of [
    "scripts/install-podcast-scheduled-workers.sh",
    "scripts/migrate-legacy-podcast-cron.sh",
  ]) {
    const path = join(root, relative);
    assert.notEqual(statSync(path).mode & 0o111, 0);
    const syntax = spawnSync("bash", ["-n", path], { encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
  const installer = source("scripts/install-podcast-scheduled-workers.sh");
  assert.match(installer, /aic-podcast-daily-ingest\.timer/);
  assert.match(installer, /aic-podtrac-daily-ingest\.timer/);
  assert.match(installer, /sudo install -o root -g root -m 0644/);
  assert.match(installer, /ENABLE_TIMERS="\$\{ENABLE_TIMERS:-0\}"/);
  assert.match(installer, /START_TIMERS=1 requires ENABLE_TIMERS=1/);
  assert.match(installer, /repo_dir.*\/mnt\/storage\/aic/);
  assert.match(source("scripts/migrate-legacy-podcast-cron.sh"), /must run from \/mnt\/storage\/aic/);
});

test("successful scheduled ingest runs bounded create-only draft sync and intelligence recovery", () => {
  const worker = source("scripts/process_admin_operation_requests.py");
  const service = source("systemd/aic-podcast-daily-ingest.service");

  assert.match(worker, /sync_canonical_episode_drafts\.py/);
  assert.match(worker, /recover_failed_episode_intelligence\.py/);
  assert.match(worker, /CREATE_MISSING_CANONICAL_EPISODE_DRAFTS/);
  assert.match(worker, /if return_code == 0 and args\.scheduled_stage == "daily-ingest"/);
  assert.match(worker, /"--max-creates",\s*"10"/);
  assert.match(worker, /"--max-candidates",\s*"4"/);
  assert.match(worker, /shell=False/);
  assert.match(service, /TimeoutStartSec=4h 30m/);
});

test("cron migration removes only the two exact active legacy jobs and is idempotent", () => {
  const daily = "15 4 * * * cd /mnt/storage/aic_podcast && /mnt/storage/aic_podcast/.venv-pg/bin/python -u run_daily_podcast_ingest.py --transcribe-engine mistral --max-tracks 50 --transcribe-workers 4 --intelligence-workers 4 --intelligence-provider silo --intelligence-model openai-codex/gpt-5.6-luna --intelligence-reasoning-effort medium --no-extractive-fallback >> /mnt/storage/aic_podcast/run_logs/cron_daily_ingest.log 2>&1";
  const podtrac = "15 4 * * * /usr/bin/flock -n /tmp/aic_podtrac_ingest.lock /mnt/storage/aic_podcast/scripts/run_podtrac_daily_server.sh >> /mnt/storage/aic_podcast/run_logs/cron_podtrac_daily.log 2>&1";
  const commentedDaily = `#${daily}`;
  const unrelated = "30 2 * * * /srv/unrelated-backup";
  const file = join(tmpdir(), `aic-podcast-cron-test-${process.pid}-${Date.now()}`);
  const script = join(root, "scripts/migrate-legacy-podcast-cron.sh");
  writeFileSync(file, ["", unrelated, daily, commentedDaily, "# AIC Podtrac daily ingest", podtrac, ""].join("\n"), { mode: 0o600 });
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    AIC_CRON_MIGRATION_TEST_MODE: "1",
    AIC_CRON_TEST_FILE: file,
  };
  try {
    const first = spawnSync(script, [], { encoding: "utf8", env: environment });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Removed 2 exact legacy AIC podcast cron entries/);
    const updated = readFileSync(file, "utf8");
    assert.equal(updated.includes(`\n${daily}\n`), false);
    assert.equal(updated.includes(`\n${podtrac}\n`), false);
    assert.match(updated, new RegExp(unrelated.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(updated, new RegExp(commentedDaily.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const second = spawnSync(script, [], { encoding: "utf8", env: environment });
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /already absent/);
    assert.equal(readFileSync(file, "utf8"), updated);
  } finally {
    rmSync(file, { force: true });
  }
});
