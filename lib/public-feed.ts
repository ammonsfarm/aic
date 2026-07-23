import { sanitizeCmsHtml } from "@/lib/cms-html";
import { canonicalPublicUrl } from "@/lib/public-seo";
import type { PublishedPost } from "@/lib/strapi-structured-public";

const FEED_TITLE = "Abiding in Christ with Jim Wood";
const FEED_DESCRIPTION = "Bible teaching, devotionals, and written resources from Pastor Jim Wood.";
const SAFE_POST_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

export const PUBLIC_FEED_MAX_ITEMS = 100;
export const PUBLIC_FEED_SUMMARY_MAX_CHARACTERS = 2_000;
export const PUBLIC_FEED_BODY_MAX_CHARACTERS = 20_000;

function xmlText(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stableDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function postDate(post: PublishedPost) {
  return stableDate(post.publishDate) || stableDate(post.publishedAt) || stableDate(post.createdAt);
}

function postLink(post: PublishedPost) {
  const slug = post.slug.trim();
  if (!slug || slug.length > 200 || !SAFE_POST_SLUG.test(slug)) return "";
  return canonicalPublicUrl(`/writings/${slug}/`);
}

function boundedText(value: string, maxCharacters: number) {
  const characters = Array.from(value);
  return {
    value: characters.slice(0, maxCharacters).join(""),
    truncated: characters.length > maxCharacters,
  };
}

function absoluteFeedHtml(value: string) {
  return value.replace(/\b(href|src)="(\/[^"\s]*)"/g, (_match, attribute: string, encodedPath: string) => {
    const path = encodedPath.replace(/&amp;/g, "&");
    const absoluteUrl = canonicalPublicUrl(path).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    return `${attribute}="${absoluteUrl}"`;
  });
}

function feedItem(post: PublishedPost) {
  const link = postLink(post);
  const title = post.title.trim();
  if (!link || !title) return "";
  const date = postDate(post);
  const summarySource = boundedText(post.summary || post.body, PUBLIC_FEED_SUMMARY_MAX_CHARACTERS);
  const bodySource = boundedText(post.body || post.summary, PUBLIC_FEED_BODY_MAX_CHARACTERS);
  const summary = absoluteFeedHtml(sanitizeCmsHtml(summarySource.value));
  const sanitizedBody = absoluteFeedHtml(sanitizeCmsHtml(bodySource.value));
  const body = bodySource.truncated
    ? `${sanitizedBody}<p><a href="${link}">Continue reading on PastorWood.org</a></p>`
    : sanitizedBody;
  return [
    "    <item>",
    `      <title>${xmlText(title)}</title>`,
    `      <link>${xmlText(link)}</link>`,
    `      <guid isPermaLink="true">${xmlText(link)}</guid>`,
    date ? `      <pubDate>${date.toUTCString()}</pubDate>` : "",
    summary ? `      <description>${xmlText(summary)}</description>` : "",
    body ? `      <content:encoded>${xmlText(body)}</content:encoded>` : "",
    "    </item>",
  ].filter(Boolean).join("\n");
}

export function buildPublicPostsFeed(posts: PublishedPost[]) {
  const datedPosts = posts
    .map((post, index) => ({ post, index, date: postDate(post) }))
    .filter(({ post }) => Boolean(postLink(post) && post.title.trim()));
  datedPosts.sort((left, right) => {
    const dateDifference = (right.date?.getTime() || 0) - (left.date?.getTime() || 0);
    return dateDifference || left.index - right.index;
  });
  const feedPosts = datedPosts.slice(0, PUBLIC_FEED_MAX_ITEMS);
  const items = feedPosts.map(({ post }) => feedItem(post)).filter(Boolean);
  const lastBuildDate = feedPosts.find(({ date }) => date)?.date || null;
  const siteUrl = canonicalPublicUrl("/");
  const feedUrl = canonicalPublicUrl("/feed/");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    "  <channel>",
    `    <title>${xmlText(FEED_TITLE)}</title>`,
    `    <link>${xmlText(siteUrl)}</link>`,
    `    <description>${xmlText(FEED_DESCRIPTION)}</description>`,
    "    <language>en-US</language>",
    `    <atom:link href="${xmlText(feedUrl)}" rel="self" type="application/rss+xml" />`,
    lastBuildDate ? `    <lastBuildDate>${lastBuildDate.toUTCString()}</lastBuildDate>` : "",
    ...items,
    "  </channel>",
    "</rss>",
  ].filter((line) => line !== "").join("\n") + "\n";
}
