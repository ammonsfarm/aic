import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("mobile console containment keeps overlays inside the viewport without hiding table overflow", async () => {
  const css = await source("app/globals.css");

  assert.match(css, /\.top-rail__menu\s*\{\s*position:\s*static;/);
  assert.match(css, /\.top-rail__submenu\s*\{[^}]*right:\s*16px;[^}]*left:\s*16px;[^}]*width:\s*auto;/s);
  assert.match(css, /@media \(min-width: 721px\) and \(max-width: 900px\)/);
  assert.match(css, /\.status-list\s*\{[^}]*min-width:\s*0;/s);
  assert.match(css, /\.responsive-table\s*\{\s*overflow-x:\s*auto;/);
  assert.doesNotMatch(css, /body\s*\{[^}]*overflow-x:\s*hidden/s);
});

test("pipeline status summaries and mutations expose explicit semantic and audit contracts", async () => {
  const [page, freshness, controls] = await Promise.all([
    source("app/(private)/pipeline/page.tsx"),
    source("components/data-freshness.tsx"),
    source("components/pipeline-operations.tsx"),
  ]);

  assert.match(page, /<article className=.*status-card/);
  assert.match(freshness, /status-card__title/);
  assert.match(freshness, /status-card__detail/);
  assert.match(freshness, /status-card__meta/);
  assert.match(controls, /Required audit reason/);
  assert.match(controls, /name="reason"[^>]*required/);
  assert.match(controls, /Required audit note/);
  assert.match(controls, /name="note"[^>]*required/);
  assert.match(controls, /name="trackId"[^>]*required/);
  assert.match(controls, /action: "match"/);
  assert.match(controls, /action: "unmatch"/);
});
