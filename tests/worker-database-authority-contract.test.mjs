import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = (path) => readFileSync(join(root, path), "utf8");

test("admin and episode child processes have one fixed database authority", () => {
  const databaseEnv = source("scripts/aic_database_env.py");
  const admin = source("scripts/process_admin_operation_requests.py");
  const episode = source("scripts/process_episode_publish_requests.py");

  assert.match(databaseEnv, /CANONICAL_AIC_ENV = Path\("\/mnt\/storage\/aic\/\.env"\)/);
  assert.match(databaseEnv, /CANONICAL_PODCAST_ENV = Path\("\/mnt\/storage\/aic_podcast\/\.env"\)/);
  assert.match(databaseEnv, /key == "DATABASE_URL" or key\.startswith\("PG"\)/);
  assert.match(databaseEnv, /PODCAST_SUPPLEMENTAL_DECLARED_KEYS/);
  assert.match(databaseEnv, /PODCAST_SUBPROCESS_ENV_KEYS/);
  assert.match(databaseEnv, /PROCESS_CONTROL_ENV_KEYS/);
  assert.match(databaseEnv, /values\[key\] != canonical_values\.get\(key\)/);

  assert.match(admin, /"--env-file",\s+str\(env_file\)/);
  assert.match(admin, /"--workspace",\s+str\(podcast_root\)/);
  assert.match(admin, /ops\/podtrac\/run_daily_podtrac_ingest\.py/);
  assert.match(admin, /"--server-admin-mode"/);
  assert.match(admin, /"--curl-file",\s+str\(podcast_root \/ "podtrac-auth\.curl"\)/);
  assert.doesNotMatch(admin, /run_podtrac_daily_server\.sh/);
  assert.doesNotMatch(admin, /os\.environ\.get\("AIC_(?:WEB|PODCAST)_(?:ROOT|PYTHON)"/);

  assert.match(episode, /canonical_env_file=args\.env_file/);
  assert.match(episode, /podcast_python=DEFAULT_PODCAST_PYTHON/);
  assert.match(episode, /env=child_env\.copy\(\)/);
  assert.doesNotMatch(episode, /"--env-file",\s+str\(podcast_env_file\)/);
});

test("systemd workers clear inherited routing before fixed canonical arguments", () => {
  for (const unit of [
    "systemd/aic-admin-operations-worker.service",
    "systemd/aic-episode-publish-worker.service",
    "systemd/aic-podcast-daily-ingest.service",
    "systemd/aic-podtrac-daily-ingest.service",
  ]) {
    const text = source(unit);
    assert.match(text, /UnsetEnvironment=DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD DATABASE_URL/);
    assert.match(text, /UnsetEnvironment=PGHOST[\s\S]*PGOPTIONS[\s\S]*PGSSLMODE/);
    assert.match(text, /UnsetEnvironment=PYTHONPATH PYTHONHOME LD_PRELOAD LD_LIBRARY_PATH BASH_ENV ENV NODE_OPTIONS/);
    assert.match(text, /--env-file \/mnt\/storage\/aic\/\.env/);
    assert.match(text, /--podcast-env-file \/mnt\/storage\/aic_podcast\/\.env/);
  }
});

test("versioned Podtrac server mode pins runner, interpreter, auth, logs, and canonical env", () => {
  const podtrac = source("ops/podtrac/run_daily_podtrac_ingest.py");
  assert.match(podtrac, /SERVER_ENV_FILE = SERVER_AIC_ROOT \/ "\.env"/);
  assert.match(podtrac, /SERVER_CURL_FILE = SERVER_PODCAST_ROOT \/ "podtrac-auth\.curl"/);
  assert.match(podtrac, /SERVER_LOG_DIR = SERVER_PODCAST_ROOT \/ "run_logs"/);
  assert.match(podtrac, /SERVER_PYTHON = SERVER_AIC_ROOT \/ "\.venv-pg\/bin\/python"/);
  assert.match(podtrac, /validate_server_admin_runtime\(args\)/);
  assert.match(podtrac, /args\.auth_mode != "curl"/);
});
