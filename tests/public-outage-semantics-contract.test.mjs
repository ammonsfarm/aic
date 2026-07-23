import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dataSource, listings, radioDetail, writingDetail] = await Promise.all([
  readFile(new URL("../lib/strapi-structured-public.ts", import.meta.url), "utf8"),
  readFile(new URL("../components/pastor-wood-structured-listings.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/radio/[[...slug]]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/writings/[slug]/page.tsx", import.meta.url), "utf8"),
]);

test("public detail lookups preserve found, missing, and unavailable states", () => {
  assert.match(dataSource, /type PublishedLookupResult<T>/);
  assert.match(dataSource, /getPublishedEpisodeBySlugResult/);
  assert.match(dataSource, /getPublishedPostBySlugResult/);
  assert.match(dataSource, /returned a malformed collection item/);
  assert.match(dataSource, /returned malformed pagination data/);
  assert.match(radioDetail, /result\.status === "unavailable"/);
  assert.match(radioDetail, /result\.status === "not-found"/);
  assert.match(writingDetail, /result\.status === "unavailable"/);
  assert.match(writingDetail, /result\.status === "not-found"/);
});

test("public listings consume availability before interpreting an empty item array", () => {
  assert.match(dataSource, /listPublishedBoardMembersResult/);
  assert.match(dataSource, /listPublishedEndorsementsResult/);
  assert.match(listings, /if \(!result\.available\)/);
  assert.match(listings, /No board members are published yet/);
  assert.match(listings, /No endorsements are published yet/);
  assert.match(listings, /No devotionals are published yet/);
  assert.match(listings, /No writings are published yet/);
  assert.match(listings, /role="alert"/);
});
