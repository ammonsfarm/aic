import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [writingsIndex, homeRoute, abidingRoute, publicSite, globalStyles] = await Promise.all([
  readFile(new URL("../app/writings/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/abiding-in-christ/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/pastor-wood-site.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
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
  assert.match(homeRoute, /getPublicFixedCmsPage\("home"\)/);
  assert.match(homeRoute, /<PastorWoodSite cmsPage=/);
  assert.match(abidingRoute, /getPublicFixedCmsPage\("abiding-in-christ"\)/);
  assert.match(abidingRoute, /page="abiding"/);
  assert.match(publicSite, /Browse the public radio archive/);
});

test("legacy policy content cannot replace the current subscription notice", () => {
  assert.match(publicSite, /function SubscriptionPrivacyNotice\(\)/);
  assert.match(publicSite, /\{cmsPage\?\.sections\?\.length \? <CmsPageSections[\s\S]*?<SubscriptionPrivacyNotice \/>/);
});

test("About uses sanitized CMS sections and hides its static portrait when managed sections exist", () => {
  assert.match(publicSite, /dangerouslySetInnerHTML=\{\{ __html: sanitizeCmsHtml\(value\) \}\}/);
  assert.match(publicSite, /\{hasCmsSections \? \([\s\S]*?<CmsPageSections sections=\{cmsPage\?\.sections\} \/>[\s\S]*?\) : \([\s\S]*?pastor-wood\.jpg/);
});

test("every fixed public route declares route-specific metadata and a canonical path", () => {
  for (const [file, source] of fixedRouteSources) {
    assert.match(source, /generateMetadata|export const metadata/, `${file} must declare metadata`);
    assert.match(source, /path:\s*(?:[`"']|publicArchiveCanonicalPath\()/, `${file} must declare a canonical path`);
  }
});

test("paginated archives use page-aware canonicals while radio details retain their own canonical", () => {
  const sources = new Map(fixedRouteSources);
  for (const file of ["bible-study/page.tsx", "written-resources/page.tsx", "radio/[[...slug]]/page.tsx"]) {
    const source = sources.get(file);
    assert.match(source, /generateMetadata\(\{[^}]*searchParams/);
    assert.match(source, /publicArchiveCanonicalPath/);
  }
  assert.match(sources.get("radio/[[...slug]]/page.tsx"), /path: `\/radio\/\$\{episode\.slug\}\//);
});

test("unsubscribe has one main landmark supplied by PastorWoodShell", () => {
  const unsubscribe = new Map(fixedRouteSources).get("unsubscribe/page.tsx");
  assert.match(unsubscribe, /<PastorWoodShell>/);
  assert.doesNotMatch(unsubscribe, /<main\b/);
  assert.match(unsubscribe, /<section className="pw-section pw-writing-detail">/);
});

test("public controls keep a strong keyboard focus ring and honor reduced motion", () => {
  assert.match(globalStyles, /\.pw-site :where\(a, button, input, select, textarea, summary, audio\):focus-visible\s*\{[\s\S]*?outline: 3px solid var\(--pw-night\) !important;[\s\S]*?box-shadow: 0 0 0 6px var\(--pw-gold\);/);
  assert.match(globalStyles, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?scroll-behavior: auto;[\s\S]*?animation-duration: 0\.01ms !important;[\s\S]*?transition-duration: 0\.01ms !important;/);
  for (const selector of [".pw-nav__links a:focus-visible", ".pw-button:focus-visible", ".pw-link-band a:focus-visible", ".pw-listen-card:focus-visible"]) {
    const start = globalStyles.indexOf(selector);
    assert.notEqual(start, -1, `${selector} must exist`);
    assert.doesNotMatch(globalStyles.slice(start, globalStyles.indexOf("}", start) + 1), /outline:\s*none/);
  }
});
