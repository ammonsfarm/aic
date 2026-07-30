import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [proxy, routeAccess, navigation] = await Promise.all([
  readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/route-access.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/navigation.ts", import.meta.url), "utf8"),
]);

test("episode intelligence and reading plan tools remain signed-in surfaces", () => {
  assert.doesNotMatch(proxy, /"\/episodes\(\.\*\)"/);
  assert.doesNotMatch(proxy, /"\/reading-plan\(\.\*\)"/);
  assert.match(routeAccess, /"console"/);
  assert.match(routeAccess, /"episodes"/);
  assert.match(routeAccess, /"reading-plan"/);
});

test("signed-out navigation advertises only working PastorWood public routes", () => {
  const publicBlock = navigation.slice(navigation.indexOf("export const publicNav"));
  for (const privatePath of ["/console", "/episodes", "/sermons", "/research", "/reading-plan", "/podcast"]) {
    assert.doesNotMatch(publicBlock, new RegExp(`href: "${privatePath.replace("/", "\\/")}"`));
  }
  assert.match(publicBlock, /href: "\/radio"/);
  assert.match(publicBlock, /href: "\/written-resources"/);
});

test("RAG and episode APIs are not added to the public API allowlist", () => {
  assert.doesNotMatch(proxy, /api\/episodes/);
  assert.doesNotMatch(proxy, /api\/rag/);
});

test("unsubscribe is public while unknown signed-out paths fall through to a real Next 404", () => {
  assert.match(proxy, /"\/api\/public\/subscriptions\(\.\*\)"/);
  assert.match(proxy, /"\/api\/public\/contact"/);
  assert.match(proxy, /"\/unsubscribe\(\.\*\)"/);
  assert.match(proxy, /Unknown signed-out paths belong to Next's routing layer/);
  assert.match(proxy, /if \(isKnownPrivatePath\(request\.nextUrl\.pathname\)\) \{\s*return redirectToLogin\(request\);\s*\}/);
  assert.doesNotMatch(routeAccess, /"missing-page"/);
});

test("the RSS feed is an explicit signed-out public route", () => {
  assert.match(proxy, /"\/feed\(\.\*\)"/);
});

test("dynamic CMS page ownership is resolved before any legacy redirect", () => {
  const pageOwnershipIndex = proxy.indexOf("await shouldPreserveDynamicCmsPagePath(request.nextUrl.pathname)");
  const legacyRedirectIndex = proxy.indexOf("await resolvePublicLegacyRedirect(request.nextUrl.pathname)");
  assert.ok(pageOwnershipIndex >= 0);
  assert.ok(legacyRedirectIndex > pageOwnershipIndex);
});
