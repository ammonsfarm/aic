import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helperUrl = pathToFileURL(join(root, "scripts", "public_cache_invalidation.mjs")).href;
const childSource = `
  import { withPublicCacheInvalidationFlushLock } from ${JSON.stringify(helperUrl)};
  import { access, writeFile } from "node:fs/promises";
  const exists = async (path) => access(path).then(() => true, () => false);
  await withPublicCacheInvalidationFlushLock(process.env.TEST_MARKER, async () => {
    await writeFile(process.env.TEST_READY, "ready\\n", { mode: 0o600 });
    for (let attempt = 0; attempt < 500; attempt += 1) {
      if (await exists(process.env.TEST_RELEASE)) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("test lock release timed out");
  });
`;

async function waitForFile(path, description) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`${description} was not created`);
}

function launch(cwd, marker, ready, release) {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", childSource], {
    cwd,
    env: {
      ...process.env,
      TEST_MARKER: marker,
      TEST_READY: ready,
      TEST_RELEASE: release,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const completed = new Promise((resolveCompleted, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveCompleted({ code, stdout, stderr }));
  });
  return { child, completed };
}

test("the inherited-fd flock serializes different processes and working directories", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aic-public-cache-flock-"));
  const firstCwd = join(sandbox, "first-cwd");
  const secondCwd = join(sandbox, "second-cwd");
  const markerDirectory = join(sandbox, "state");
  const marker = join(markerDirectory, "cache-revalidation-pending.json");
  const firstReady = join(sandbox, "first-ready");
  const firstRelease = join(sandbox, "first-release");
  const secondReady = join(sandbox, "second-ready");
  const secondRelease = join(sandbox, "second-release");
  let first;
  let second;
  try {
    mkdirSync(firstCwd, { mode: 0o700 });
    mkdirSync(secondCwd, { mode: 0o700 });
    mkdirSync(markerDirectory, { mode: 0o700 });

    first = launch(firstCwd, marker, firstReady, firstRelease);
    await waitForFile(firstReady, "first lock acquisition marker");
    second = launch(secondCwd, marker, secondReady, secondRelease);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    assert.equal(existsSync(secondReady), false, "second process entered while the first held the lock");

    writeFileSync(firstRelease, "release\n", { mode: 0o600 });
    await waitForFile(secondReady, "second lock acquisition marker");
    writeFileSync(secondRelease, "release\n", { mode: 0o600 });

    const [firstResult, secondResult] = await Promise.all([first.completed, second.completed]);
    assert.equal(firstResult.code, 0, firstResult.stderr);
    assert.equal(secondResult.code, 0, secondResult.stderr);
    assert.equal(existsSync(join(firstCwd, "3")), false);
    assert.equal(existsSync(join(secondCwd, "3")), false);
    assert.equal(existsSync(`${marker}.lock`), true);
  } finally {
    if (first?.child.exitCode === null && first.child.signalCode === null) first.child.kill();
    if (second?.child.exitCode === null && second.child.signalCode === null) second.child.kill();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
