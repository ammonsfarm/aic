import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projection = vi.hoisted(() => ({
  identity: vi.fn(),
  listAll: vi.fn(),
  page: vi.fn(),
  media: vi.fn(),
}));
const fallback = vi.hoisted(() => ({
  postsPage: vi.fn(),
  postBySlug: vi.fn(),
  episodesPage: vi.fn(),
  episodeBySlug: vi.fn(),
  episodeByTrackId: vi.fn(),
}));

vi.mock("@/lib/public-content-projection", () => ({
  getProjectedContentByIdentity: projection.identity,
  listAllProjectedContent: projection.listAll,
  listProjectedContentPage: projection.page,
  getProjectedPublicMedia: projection.media,
}));
vi.mock("@/lib/pastorwood-public-fallback", () => ({
  getFallbackPostsPage: fallback.postsPage,
  getFallbackPostBySlug: fallback.postBySlug,
  getFallbackEpisodesPage: fallback.episodesPage,
  getFallbackEpisodeBySlug: fallback.episodeBySlug,
  getFallbackEpisodeByTrackId: fallback.episodeByTrackId,
}));

import redirects from "@/data/legacy-redirects.json";
import { authorizedPublishedCmsMedia } from "@/lib/cms-public-media";
import { POST as subscribe } from "@/app/api/public/subscriptions/route";
import { resolveLegacyRedirect, resolvePublicLegacyRedirect } from "@/lib/legacy-redirects";
import {
  disablePastorWoodPublicCmsCutoverForTests,
  enablePastorWoodPublicCmsCutoverForTests,
  pastorWoodPublicCmsCutoverEnabled,
} from "@/lib/pastorwood-public-cms-cutover";
import { getStrapiPageByPageKeyResult, getStrapiPageBySlugResult } from "@/lib/strapi";
import { getPublishedPageSitemapListing } from "@/lib/strapi-public-pages";
import { resetPublicStrapiCircuitForTests } from "@/lib/strapi-request";
import { getManagedSiteSettings, getPublishedManagedSiteSettings } from "@/lib/strapi-site-settings-management";
import { getStrapiSiteSettings } from "@/lib/strapi-site-settings";
import {
  listPublicMediaAssets,
  listPublicRedirects,
  getPublishedEpisodeBySlugResult,
  getPublishedPostBySlugResult,
  listLatestPublishedPostsResult,
  listPublishedBoardMembersResult,
  listPublishedEndorsementsResult,
  listPublishedEpisodesPage,
  listPublishedPostsPage,
} from "@/lib/strapi-structured-public";

const fallbackPost = {
  documentId: "bootstrap-post",
  title: "Bootstrap post",
  slug: "bootstrap-post",
  contentType: "written",
  summary: "",
  body: "",
  publishDate: null,
};
const fallbackEpisode = {
  documentId: "bootstrap-episode",
  title: "Bootstrap episode",
  slug: "bootstrap-episode",
  trackId: "bootstrap-track",
  programDate: "2026-07-20",
  summary: "",
  description: "",
  audioUrl: "",
  durationSeconds: null,
};

beforeEach(() => {
  resetPublicStrapiCircuitForTests();
  disablePastorWoodPublicCmsCutoverForTests();
  process.env.STRAPI_URL = "https://strapi.example.test";
  process.env.STRAPI_PUBLIC_URL = "https://strapi.example.test";
  process.env.STRAPI_API_TOKEN = "read-token";
  projection.identity.mockReset();
  projection.listAll.mockReset();
  projection.page.mockReset();
  projection.media.mockReset();
  fallback.postsPage.mockReset().mockResolvedValue({
    items: [fallbackPost], page: 1, pageSize: 24, pageCount: 1, total: 1,
  });
  fallback.postBySlug.mockReset().mockResolvedValue(fallbackPost);
  fallback.episodesPage.mockReset().mockResolvedValue({
    items: [fallbackEpisode], page: 1, pageSize: 24, pageCount: 1, total: 1,
  });
  fallback.episodeBySlug.mockReset().mockResolvedValue(fallbackEpisode);
  fallback.episodeByTrackId.mockReset();
});

afterEach(() => {
  disablePastorWoodPublicCmsCutoverForTests();
  delete process.env.STRAPI_URL;
  delete process.env.STRAPI_PUBLIC_URL;
  delete process.env.STRAPI_API_TOKEN;
  for (const key of [
    "PASTORWOOD_SUBSCRIPTIONS_ENABLED",
    "MAILCHIMP_API_KEY",
    "MAILCHIMP_SERVER_PREFIX",
    "MAILCHIMP_AUDIENCE_ID",
    "MAILCHIMP_WEBHOOK_SECRET",
    "SUBSCRIPTION_RATE_LIMIT_SECRET",
    "SUBSCRIPTION_UNSUBSCRIBE_SECRET",
  ]) delete process.env[key];
  vi.unstubAllGlobals();
});

describe("PastorWood public CMS cutover gate", () => {
  it("keeps CMS authority off when the boolean is enabled without attestation evidence", () => {
    process.env.PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED = "true";
    expect(pastorWoodPublicCmsCutoverEnabled()).toBe(false);
  });

  it("defaults off, hides dynamic CMS-only slugs, and sends every public content surface directly to bootstrap continuity", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const generated = redirects[0];

    expect(pastorWoodPublicCmsCutoverEnabled()).toBe(false);
    await expect(getStrapiPageByPageKeyResult("home")).resolves.toEqual({ status: "unavailable" });
    await expect(getStrapiPageBySlugResult("cms-only-page")).resolves.toEqual({ status: "not-found" });
    await expect(getStrapiSiteSettings()).resolves.toBeNull();
    await expect(getPublishedPageSitemapListing()).resolves.toEqual({ entries: [], source: "unavailable" });
    await expect(authorizedPublishedCmsMedia("media-doc")).resolves.toBeNull();
    await expect(resolvePublicLegacyRedirect(generated.fromPath)).resolves.toEqual(resolveLegacyRedirect(generated.fromPath));
    await expect(listPublishedPostsPage(undefined, 1, 24)).resolves.toMatchObject({
      items: [{ documentId: "bootstrap-post" }],
      degraded: false,
      continuitySource: "bootstrap",
    });
    await expect(listLatestPublishedPostsResult(24)).resolves.toMatchObject({
      items: [{ documentId: "bootstrap-post" }], degraded: false, continuitySource: "bootstrap",
    });
    await expect(getPublishedPostBySlugResult("bootstrap-post")).resolves.toMatchObject({
      status: "found", item: { documentId: "bootstrap-post" }, degraded: false,
    });
    await expect(listPublishedEpisodesPage(1, 24)).resolves.toMatchObject({
      items: [{ documentId: "bootstrap-episode" }], degraded: false, continuitySource: "bootstrap",
    });
    await expect(getPublishedEpisodeBySlugResult("bootstrap-episode")).resolves.toMatchObject({
      status: "found", item: { documentId: "bootstrap-episode" }, degraded: false,
    });
    await expect(listPublishedBoardMembersResult()).resolves.toMatchObject({
      available: true, degraded: false, continuitySource: "bootstrap",
    });
    await expect(listPublishedEndorsementsResult()).resolves.toMatchObject({
      available: true, degraded: false, continuitySource: "bootstrap",
    });
    await expect(listPublicMediaAssets()).resolves.toEqual([]);
    await expect(listPublicRedirects()).resolves.toEqual([]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(projection.identity).not.toHaveBeenCalled();
    expect(projection.listAll).not.toHaveBeenCalled();
    expect(projection.page).not.toHaveBeenCalled();
    expect(projection.media).not.toHaveBeenCalled();
  });

  it("keeps public subscription capture off even when its other three gates are ready", async () => {
    Object.assign(process.env, {
      PASTORWOOD_SUBSCRIPTIONS_ENABLED: "true",
      MAILCHIMP_API_KEY: "key-us21",
      MAILCHIMP_SERVER_PREFIX: "us21",
      MAILCHIMP_AUDIENCE_ID: "9ad7bbba36",
      MAILCHIMP_WEBHOOK_SECRET: "webhook",
      SUBSCRIPTION_RATE_LIMIT_SECRET: "rate",
      SUBSCRIPTION_UNSUBSCRIBE_SECRET: "unsubscribe",
    });
    const response = await subscribe(new Request("https://aic.ammonsfarm.org/api/public/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://aic.ammonsfarm.org" },
      body: "{}",
    }));
    expect(response.status).toBe(503);
  });

  it("keeps protected management reads available while public cutover is off", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const status = url.searchParams.get("status");
      return new Response(JSON.stringify({
        data: status === "draft"
          ? { documentId: "settings-draft", siteName: "Draft settings", subscriptionEnabled: true, publishedAt: null }
          : { documentId: "settings-published", siteName: "Published settings", subscriptionEnabled: true, publishedAt: "2026-07-22T12:00:00.000Z" },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getManagedSiteSettings()).resolves.toMatchObject({
      documentId: "settings-draft",
      siteName: "Draft settings",
      publicationStatus: "published",
    });

    await expect(getPublishedManagedSiteSettings()).resolves.toMatchObject({
      documentId: "settings-published",
      subscriptionEnabled: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("treats live 200-empty as authoritative after the explicit gate is enabled", async () => {
    enablePastorWoodPublicCmsCutoverForTests();
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/pages") return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (url.pathname === "/api/posts") {
        return new Response(JSON.stringify({
          data: [],
          meta: { pagination: { page: 1, pageSize: 24, pageCount: 0, total: 0 } },
        }), { status: 200 });
      }
      throw new Error(`Unexpected public CMS request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(pastorWoodPublicCmsCutoverEnabled()).toBe(true);
    await expect(getStrapiPageByPageKeyResult("home")).resolves.toEqual({ status: "not-found" });
    await expect(listPublishedPostsPage(undefined, 1, 24)).resolves.toMatchObject({
      items: [], available: true, total: 0,
    });
    expect(fallback.postsPage).not.toHaveBeenCalled();
    expect(projection.page).not.toHaveBeenCalled();
  });
});
