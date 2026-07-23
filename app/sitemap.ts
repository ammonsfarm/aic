import type { MetadataRoute } from "next";

import { safeCmsHref } from "@/lib/cms-html";
import { isDynamicCmsPublicSlug } from "@/lib/public-routes";
import { canonicalPublicUrl, publicSiteOrigin } from "@/lib/public-seo";
import { getPublishedPageSitemapListing } from "@/lib/strapi-public-pages";
import { listAllPublishedEpisodes, listAllPublishedPosts } from "@/lib/strapi-structured-public";

export const dynamic = "force-dynamic";

const FIXED_ROUTES: Array<{ path: string; pageKey: string }> = [
  { path: "/", pageKey: "home" },
  { path: "/about-pastor-wood/", pageKey: "about" },
  { path: "/abiding-in-christ/", pageKey: "abiding-in-christ" },
  { path: "/bible-study/", pageKey: "bible-study" },
  { path: "/board-members/", pageKey: "board-members" },
  { path: "/contact/", pageKey: "contact" },
  { path: "/donate/", pageKey: "donate" },
  { path: "/donor-dashboard/", pageKey: "donor-dashboard" },
  { path: "/endorsements/", pageKey: "endorsements" },
  { path: "/privacy-terms-conditions/", pageKey: "privacy-terms-conditions" },
  { path: "/radio/", pageKey: "radio" },
  { path: "/written-resources/", pageKey: "written-resources" },
];

function sameSiteCanonical(defaultPath: string, configuredCanonical = "") {
  const safe = safeCmsHref(configuredCanonical);
  const value = safe && !safe.startsWith("#") && !safe.startsWith("mailto:") && !safe.startsWith("tel:")
    ? (safe.startsWith("/") ? canonicalPublicUrl(safe) : safe)
    : canonicalPublicUrl(defaultPath);
  try {
    const parsed = new URL(value);
    return parsed.origin === publicSiteOrigin() ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [pageListing, posts, episodes] = await Promise.all([
    getPublishedPageSitemapListing(),
    listAllPublishedPosts(),
    listAllPublishedEpisodes(),
  ]);
  const pages = pageListing.entries;
  const pageByKey = new Map(pages.map((page) => [page.pageKey, page]));
  const urls = new Set<string>();
  for (const route of FIXED_ROUTES) {
    const page = pageByKey.get(route.pageKey);
    if ((pageListing.source !== "unavailable" && !page) || page?.noIndex) continue;
    const url = sameSiteCanonical(route.path, page?.canonicalUrl);
    if (url) urls.add(url);
  }
  for (const page of pages) {
    if (!isDynamicCmsPublicSlug(page.slug) || page.noIndex) continue;
    const url = sameSiteCanonical(`/${page.slug}/`, page.canonicalUrl);
    if (url) urls.add(url);
  }
  for (const post of posts) {
    if (!post.slug || post.seo.noIndex) continue;
    const url = sameSiteCanonical(`/writings/${post.slug}/`, post.seo.canonicalUrl);
    if (url) urls.add(url);
  }
  for (const episode of episodes) {
    if (!episode.slug || episode.seo.noIndex) continue;
    const url = sameSiteCanonical(`/radio/${episode.slug}/`, episode.seo.canonicalUrl);
    if (url) urls.add(url);
  }
  return [...urls].sort().map((url) => ({ url, changeFrequency: url === canonicalPublicUrl("/") ? "daily" : "weekly" }));
}
