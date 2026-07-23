import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("deployment serializes legacy and canonical podcast jobs across mutation", () => {
  const deploy = readFileSync(resolve(root, "scripts/deploy-farm-web.sh"), "utf8");
  const dailyLock = deploy.indexOf("exec 8>>/mnt/storage/aic_podcast/daily_ingest.lock");
  const podtracLock = deploy.indexOf("exec 9>>/tmp/aic_podtrac_ingest.lock");
  const checkout = deploy.indexOf('echo "Updating code..."');
  const migrations = deploy.indexOf('echo "Applying database migrations..."');
  const timerStart = deploy.indexOf('echo "Starting verified worker and backup timers..."');
  const cronMigration = deploy.indexOf("bash scripts/migrate-legacy-podcast-cron.sh");

  assert.ok(dailyLock >= 0 && podtracLock > dailyLock);
  assert.match(deploy, /\/usr\/bin\/flock -n 8/);
  assert.match(deploy, /\/usr\/bin\/flock -n 9/);
  assert.ok(checkout > podtracLock);
  assert.ok(migrations > checkout);
  assert.ok(timerStart > migrations);
  assert.ok(cronMigration > timerStart);
  assert.match(deploy, /aic-podcast-daily-ingest\.timer/);
  assert.match(deploy, /aic-podtrac-daily-ingest\.timer/);
  assert.match(deploy, /INSTALL_PODCAST_SCHEDULED_WORKERS/);
});
