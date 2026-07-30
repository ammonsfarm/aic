import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editor = await readFile(
  new URL("../app/(private)/content/strapi-pages/[documentId]/page.tsx", import.meta.url),
  "utf8",
);

test("published CMS pages do not link to disabled public routing", () => {
  assert.match(editor, /pastorWoodPublicCmsCutoverEnabled/);
  assert.match(editor, /const publicCutoverReady = pastorWoodPublicCmsCutoverEnabled\(\)/);
  assert.match(editor, /page\.publicationStatus === "published" && publicCutoverReady \? <Link[\s\S]*?>View public page<\/Link>/);
  assert.doesNotMatch(editor, /page\.publicationStatus === "published" \? <Link[\s\S]*?>View public page<\/Link>/);
});

test("published CMS pages explain pre-cutover state without implying an outage or launch stage", () => {
  assert.match(editor, /Published in CMS\. Public CMS routing is disabled in this pre-cutover environment\. Use Preview draft until the reviewed cutover is enabled\./);
  assert.match(editor, /The page is published in CMS, but public CMS routing is disabled in this pre-cutover environment\./);
  assert.doesNotMatch(editor, /development host/);
  assert.match(editor, /Preview draft/);
});
