import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export const PUBLIC_CACHE_INVALIDATION_URL = "http://127.0.0.1:8087/api/revalidate/strapi";
export const SCHEDULED_PUBLICATION_INVALIDATION_MARKER =
  "/var/lib/aic-scheduled-publication/cache-revalidation-pending.json";

function validSecret(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function assertPublicCacheInvalidationSecret(secret) {
  if (!validSecret(secret)) throw new Error("Public cache invalidation secret is not configured.");
}

function validSource(value) {
  return typeof value === "string" && /^[a-z0-9-]{1,64}$/.test(value);
}

function markerPayload(source) {
  if (!validSource(source)) throw new Error("Public cache invalidation source is invalid.");
  return {
    version: 1,
    pending: true,
    source,
    markedAt: new Date().toISOString(),
  };
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertMarkerTargetIsReplaceable(markerPath) {
  try {
    const stats = await lstat(markerPath);
    if (!stats.isFile()) throw new Error("Public cache invalidation marker path is not a regular file.");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
}

function claimedMarkerPath(markerPath) {
  return `${markerPath}.inflight`;
}

function flushLockPath(markerPath) {
  return `${markerPath}.lock`;
}

async function acquireFlushLock(markerPath) {
  const lockPath = flushLockPath(markerPath);
  let handle;
  let child;
  try {
    handle = await open(
      lockPath,
      fsConstants.O_CREAT | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW,
      0o600,
    );
    const stats = await handle.stat();
    if (!stats.isFile() || (stats.mode & 0o777) !== 0o600) {
      throw new Error("Public cache invalidation lock is invalid.");
    }
    if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
      throw new Error("Public cache invalidation lock has an unexpected owner.");
    }

    child = spawn(
      "/bin/sh",
      ["-c", 'set -eu; /usr/bin/flock --exclusive 3; printf "locked\\n"; /bin/cat >/dev/null'],
      { stdio: ["pipe", "pipe", "ignore", handle.fd] },
    );
    child.stdout.setEncoding("utf8");

    await new Promise((resolve, reject) => {
      let output = "";
      const fail = () => reject(new Error("Public cache invalidation lock could not be acquired."));
      child.once("error", fail);
      child.once("exit", (code) => {
        if (code !== null) fail();
      });
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output === "locked\n") resolve();
        else if (output.length >= 7) fail();
      });
    });

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      const exit = child.exitCode === null && child.signalCode === null
        ? new Promise((resolve) => child.once("exit", (code) => resolve(code)))
        : Promise.resolve(child.exitCode ?? 1);
      child.stdin.end();
      const exitCode = await exit;
      await handle.close();
      handle = undefined;
      if (exitCode !== 0) throw new Error("Public cache invalidation lock was lost.");
    };
  } catch {
    child?.stdin?.destroy();
    child?.kill();
    await handle?.close().catch(() => undefined);
    throw new Error("Public cache invalidation lock could not be acquired.");
  }
}

export async function withPublicCacheInvalidationFlushLock(markerPath, operation) {
  if (typeof operation !== "function") throw new Error("Public cache invalidation lock operation is invalid.");
  const release = await acquireFlushLock(markerPath);
  try {
    return await operation();
  } finally {
    await release();
  }
}

export async function markPublicCacheInvalidationPending(markerPath, source) {
  const directory = dirname(markerPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertMarkerTargetIsReplaceable(markerPath);
  const temporary = `${markerPath}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(markerPayload(source))}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, markerPath);
    await syncDirectory(directory);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function readMarker(markerPath) {
  let stats;
  try {
    stats = await lstat(markerPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("Public cache invalidation marker could not be inspected.");
  }
  if (!stats.isFile() || stats.size > 4_096) {
    throw new Error("Public cache invalidation marker is invalid.");
  }

  let payload;
  try {
    payload = JSON.parse(await readFile(markerPath, "utf8"));
  } catch {
    throw new Error("Public cache invalidation marker is invalid.");
  }
  if (
    !payload
    || typeof payload !== "object"
    || payload.version !== 1
    || payload.pending !== true
    || !validSource(payload.source)
    || typeof payload.markedAt !== "string"
  ) {
    throw new Error("Public cache invalidation marker is invalid.");
  }
  return payload;
}

export async function readPendingPublicCacheInvalidation(markerPath) {
  return await readMarker(markerPath) ?? await readMarker(claimedMarkerPath(markerPath));
}

async function claimPendingPublicCacheInvalidation(markerPath) {
  const claimedPath = claimedMarkerPath(markerPath);
  const existingClaim = await readMarker(claimedPath);
  if (existingClaim) return { marker: existingClaim, claimedPath };

  await assertMarkerTargetIsReplaceable(markerPath);
  try {
    await rename(markerPath, claimedPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("Public cache invalidation marker could not be claimed.");
  }
  await syncDirectory(dirname(markerPath));
  const marker = await readMarker(claimedPath);
  if (!marker) throw new Error("Public cache invalidation marker claim was lost.");
  return { marker, claimedPath };
}

export async function requestPublicCacheInvalidation({ secret, source, fetchImpl = fetch }) {
  assertPublicCacheInvalidationSecret(secret);
  if (!validSource(source)) throw new Error("Public cache invalidation source is invalid.");

  let response;
  try {
    response = await fetchImpl(PUBLIC_CACHE_INVALIDATION_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event: "entry.publish", source }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Public cache invalidation route is unavailable.");
  }

  let payload = null;
  try {
    const text = await response.text();
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Public cache invalidation route returned an invalid response.");
  }
  if (!response.ok || payload?.revalidated !== true) {
    throw new Error(`Public cache invalidation was not confirmed (HTTP ${response.status}).`);
  }
}

export async function flushPendingPublicCacheInvalidation({ markerPath, secret, fetchImpl = fetch }) {
  return await withPublicCacheInvalidationFlushLock(markerPath, async () => {
    let flushed = false;
    while (true) {
      const claim = await claimPendingPublicCacheInvalidation(markerPath);
      if (!claim) return flushed;
      await requestPublicCacheInvalidation({ secret, source: claim.marker.source, fetchImpl });
      await rm(claim.claimedPath);
      await syncDirectory(dirname(markerPath));
      flushed = true;
    }
  });
}
