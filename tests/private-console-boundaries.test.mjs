import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function source(path) {
  return readFile(resolve(root, path), "utf8");
}

test("protected console route families ship loading and recovery boundaries", async () => {
  for (const path of [
    "app/(private)/loading.tsx",
    "app/(private)/error.tsx",
    "app/(private)/content/loading.tsx",
    "app/(private)/content/error.tsx",
    "app/podcast/loading.tsx",
    "app/podcast/error.tsx",
    "app/episodes/loading.tsx",
    "app/episodes/error.tsx",
    "app/research/loading.tsx",
    "app/research/error.tsx",
    "app/reading-plan/loading.tsx",
    "app/reading-plan/error.tsx",
    "app/sermons/loading.tsx",
    "app/sermons/error.tsx",
    "app/preview/loading.tsx",
    "app/preview/error.tsx",
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
  assert.match(access, /canUseResearchConsole\(appUser\.role\)/);
  assert.match(access, /redirect\(roleLandingPath\(appUser\.role\)\)/);

  for (const path of ["app/(private)/compose/page.tsx", "app/research/page.tsx", "app/reading-plan/page.tsx"]) {
    assert.match(await source(path), /await requireResearchConsoleUser\(\)/);
  }

  for (const path of ["app/research/page.tsx", "app/reading-plan/page.tsx"]) {
    const page = await source(path);
    assert.match(page, /<TopRail variant="private" role=\{appUser\.role\}/);
  }
});

test("internal read routes enforce the same role boundary advertised by navigation", async () => {
  const access = await source("lib/console-access.ts");
  assert.match(access, /canUseInternalReadConsole\(appUser\.role\)/);
  assert.match(access, /redirect\(roleLandingPath\(appUser\.role\)\)/);

  for (const path of [
    "app/(private)/archive/page.tsx",
    "app/(private)/sources/page.tsx",
    "app/(private)/pipeline/page.tsx",
    "app/episodes/page.tsx",
    "app/episodes/[trackId]/page.tsx",
    "app/sermons/page.tsx",
  ]) {
    assert.match(await source(path), /await requireInternalReadConsoleUser\(\)/);
  }

  for (const path of ["app/podcast/page.tsx", "app/podcast/episodes/page.tsx"]) {
    assert.match(await source(path), /requireSignedInAppUser\(\)/);
    assert.doesNotMatch(await source(path), /requireInternalReadConsoleUser\(\)/);
  }
});

test("protected root routes remove inherited canonical metadata and opt out of indexing", async () => {
  const metadata = await source("lib/private-console-metadata.ts");
  assert.match(metadata, /canonical: null/);
  assert.match(metadata, /index: false/);
  assert.match(metadata, /follow: false/);
  assert.match(metadata, /nosnippet: true/);

  for (const path of [
    "app/(private)/layout.tsx",
    "app/podcast/layout.tsx",
    "app/episodes/layout.tsx",
    "app/sermons/layout.tsx",
    "app/preview/layout.tsx",
    "app/research/page.tsx",
    "app/reading-plan/page.tsx",
  ]) {
    assert.match(await source(path), /privateConsoleMetadata/);
  }
});

test("podcast charts expose exact daily values and explicit empty states", async () => {
  const podcast = await source("app/podcast/page.tsx");
  assert.match(podcast, /<table className="sr-only">/);
  assert.match(podcast, /<caption>Daily podcast download values<\/caption>/);
  assert.match(podcast, /No daily download data is available/);
  assert.match(podcast, /aria-labelledby="daily-downloads-chart-title daily-downloads-chart-description"/);

  const episodeStats = await source("app/podcast/episodes/page.tsx");
  assert.match(episodeStats, /No daily episode downloads are available/);
  assert.match(episodeStats, /No episodes match this reporting window and search/);
});

test("private navigation provides a skip target and semantic submenu links", async () => {
  const rail = await source("components/top-rail.tsx");
  const privateLayout = await source("app/(private)/layout.tsx");
  assert.match(rail, /className="console-skip-link"/);
  assert.match(rail, /href="#main-content"/);
  assert.doesNotMatch(rail, /role="menu(?:item)?"/);
  assert.match(privateLayout, /id="main-content"/);
});
