import type { MetadataRoute } from "next";

import { isDynamicCmsPublicSlug } from "@/lib/public-routes";
import { canonicalPublicUrl } from "@/lib/public-seo";
import { listAllPublishedPageSlugs } from "@/lib/strapi-public-pages";
import { listAllPublishedEpisodes, listAllPublishedPosts } from "@/lib/strapi-structured-public";

const FIXED_ROUTES = [
  "/", "/about-pastor-wood/", "/abiding-in-christ/", "/bible-study/", "/board-members/",
  "/contact/", "/donate/", "/donor-dashboard/", "/endorsements/", "/privacy-terms-conditions/", "/radio/", "/written-resources/",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [pages, posts, episodes] = await Promise.all([
    listAllPublishedPageSlugs(),
    listAllPublishedPosts(),
    listAllPublishedEpisodes(),
  ]);
  const paths = new Set([
    ...FIXED_ROUTES,
    ...pages.filter(isDynamicCmsPublicSlug).map((slug) => `/${slug}/`),
    ...posts.filter((post) => post.slug).map((post) => `/writings/${post.slug}/`),
    ...episodes.filter((episode) => episode.slug).map((episode) => `/radio/${episode.slug}/`),
  ]);
  return [...paths].sort().map((path) => ({ url: canonicalPublicUrl(path), changeFrequency: path === "/" ? "daily" : "weekly" }));
}
