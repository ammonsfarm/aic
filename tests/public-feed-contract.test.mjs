import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [layout, route, proxy] = await Promise.all([
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/feed/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
]);

test("root metadata advertises the canonical RSS endpoint", () => {
  assert.match(layout, /types:\s*\{\s*["']application\/rss\+xml["']:\s*["']\/feed\/["']/);
  assert.match(proxy, /["']\/feed\(\.\*\)["']/);
});

test("the feed route declares RSS content, cache, and retriable outage contracts", () => {
  assert.match(route, /application\/rss\+xml; charset=utf-8/);
  assert.match(route, /s-maxage=300, stale-while-revalidate=86400/);
  assert.match(route, /status:\s*503/);
  assert.match(route, /"Retry-After":\s*"300"/);
  assert.match(route, /"Cache-Control":\s*"no-store"/);
});
