import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function source(path) {
  return readFile(resolve(root, path), "utf8");
}

test("console and content route groups ship loading and recovery boundaries", async () => {
  for (const path of [
    "app/(private)/loading.tsx",
    "app/(private)/error.tsx",
    "app/(private)/content/loading.tsx",
    "app/(private)/content/error.tsx",
  ]) {
    await stat(resolve(root, path));
  }

  const loading = await source("components/console-route-loading.tsx");
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /role="status"/);
  assert.match(loading, /aria-live="polite"/);
});

test("error recovery is keyboard-focused, retryable, and production-safe", async () => {
  const recovery = await source("components/console-route-error.tsx");
  assert.match(recovery, /role="alert"/);
  assert.match(recovery, /headingRef\.current\?\.focus\(\)/);
  assert.match(recovery, /tabIndex=\{-1\}/);
  assert.match(recovery, /onClick=\{reset\}/);
  assert.match(recovery, /href=\{backHref\}/);
  assert.match(recovery, /process\.env\.NODE_ENV !== "production"/);
  assert.doesNotMatch(recovery, /\{error\.(?:message|stack|digest)\}/);
  assert.doesNotMatch(recovery, /dangerouslySetInnerHTML/);

  const rootBoundary = await source("app/error.tsx");
  assert.match(rootBoundary, /^"use client";/);
  assert.match(rootBoundary, /backHref="\/"/);
});

test("generation-only pages reject roles without research-console access", async () => {
  const access = await source("lib/console-access.ts");
  assert.match(access, /return requireResearchUser\(\)/);
  assert.doesNotMatch(access, /canUseResearchConsole/);

  for (const path of ["app/(private)/compose/page.tsx", "app/research/page.tsx", "app/reading-plan/page.tsx"]) {
    assert.match(await source(path), /await requireResearchConsoleUser\(\)/);
  }
});
