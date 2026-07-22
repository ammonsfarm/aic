import type { MetadataRoute } from "next";

import { canonicalPublicUrl } from "@/lib/public-seo";
import { listAllPublishedEpisodes, listAllPublishedPosts } from "@/lib/strapi-structured-public";

const FIXED_ROUTES = [
  "/", "/about-pastor-wood/", "/abiding-in-christ/", "/bible-study/", "/board-members/",
  "/contact/", "/donate/", "/endorsements/", "/privacy-terms-conditions/", "/radio/", "/written-resources/",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [posts, episodes] = await Promise.all([listAllPublishedPosts(), listAllPublishedEpisodes()]);
  const paths = new Set([
    ...FIXED_ROUTES,
    ...posts.filter((post) => post.slug).map((post) => `/writings/${post.slug}/`),
    ...episodes.filter((episode) => episode.slug).map((episode) => `/radio/${episode.slug}/`),
  ]);
  return [...paths].sort().map((path) => ({ url: canonicalPublicUrl(path), changeFrequency: path === "/" ? "daily" : "weekly" }));
}
