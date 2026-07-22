import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [writingsIndex, homeRoute, abidingRoute, publicSite] = await Promise.all([
  readFile(new URL("../app/writings/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/abiding-in-christ/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/pastor-wood-site.tsx", import.meta.url), "utf8"),
]);

const fixedRouteFiles = [
  "page.tsx",
  "about-pastor-wood/page.tsx",
  "abiding-in-christ/page.tsx",
  "bible-study/page.tsx",
  "board-members/page.tsx",
  "contact/page.tsx",
  "donate/page.tsx",
  "donor-dashboard/page.tsx",
  "endorsements/page.tsx",
  "privacy/page.tsx",
  "privacy-terms-conditions/page.tsx",
  "radio/[[...slug]]/page.tsx",
  "unsubscribe/page.tsx",
  "written-resources/page.tsx",
];
const fixedRouteSources = await Promise.all(
  fixedRouteFiles.map(async (file) => [file, await readFile(new URL(`../app/${file}`, import.meta.url), "utf8")]),
);

test("the legacy writings index permanently redirects without exposing research internals", () => {
  assert.match(writingsIndex, /permanentRedirect\("\/written-resources\/"\)/);
  for (const privateTerm of ["pastorwood-writings", "RAG", "embeddedChunkCount", "Original source"]) {
    assert.doesNotMatch(writingsIndex, new RegExp(privateTerm, "i"));
  }
});

test("home and Abiding in Christ are fixed published-CMS routes with explicit fallbacks", () => {
  assert.match(homeRoute, /getStrapiPageByPageKey\("home"\)/);
  assert.match(homeRoute, /<PastorWoodSite cmsPage=/);
  assert.match(abidingRoute, /getStrapiPageByPageKey\("abiding-in-christ"\)/);
  assert.match(abidingRoute, /page="abiding"/);
  assert.match(publicSite, /Browse the public radio archive/);
});

test("legacy policy content cannot replace the current subscription notice", () => {
  assert.match(publicSite, /function SubscriptionPrivacyNotice\(\)/);
  assert.match(publicSite, /\{cmsPage\?\.sections\?\.length \? <CmsPageSections[\s\S]*?<SubscriptionPrivacyNotice \/>/);
});

test("About uses sanitized CMS rich text and hides its static portrait when CMS text exists", () => {
  assert.match(publicSite, /dangerouslySetInnerHTML=\{\{ __html: sanitizeCmsHtml\(value\) \}\}/);
  assert.match(publicSite, /\{textSections\.length > 0 \? null : \([\s\S]*?pastor-wood\.jpg/);
});

test("every fixed public route declares route-specific metadata and a canonical path", () => {
  for (const [file, source] of fixedRouteSources) {
    assert.match(source, /generateMetadata|export const metadata/, `${file} must declare metadata`);
    assert.match(source, /path:\s*[`"']/, `${file} must declare a canonical path`);
  }
});
