import "server-only";

import path from "node:path";

import { fetchStrapiJsonOrNull } from "@/lib/strapi-request";

type MediaNode = { documentId: string; url: string; mime: string; size: number | null };

function findMediaNode(value: unknown, documentId: string): MediaNode | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findMediaNode(child, documentId);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const attributes = record.attributes && typeof record.attributes === "object" ? record.attributes as Record<string, unknown> : {};
  const merged = { ...attributes, ...record };
  if (merged.documentId === documentId && typeof merged.url === "string") {
    const size = typeof merged.size === "number" && Number.isFinite(merged.size) ? Math.round(merged.size * 1024) : null;
    return { documentId, url: merged.url, mime: typeof merged.mime === "string" ? merged.mime : "application/octet-stream", size };
  }
  for (const child of Object.values(record)) {
    const found = findMediaNode(child, documentId);
    if (found) return found;
  }
  return null;
}

function strapiBaseUrl() {
  return (process.env.STRAPI_URL || "").replace(/\/+$/, "");
}

function queryUrl(apiPath: string, documentId: string, relation: string, extra: Record<string, string> = {}) {
  const url = new URL(`/api/${apiPath}`, strapiBaseUrl());
  url.searchParams.set("status", "published");
  url.searchParams.set("pagination[pageSize]", "1");
  url.searchParams.set("populate", "*");
  url.searchParams.set(`filters[${relation}][documentId][$eq]`, documentId);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return url;
}

export async function authorizedPublishedCmsMedia(documentId: string) {
  const origin = strapiBaseUrl();
  if (!origin || !/^[A-Za-z0-9_-]{1,128}$/.test(documentId)) return null;
  const token = process.env.STRAPI_READ_TOKEN?.trim() || process.env.STRAPI_API_TOKEN?.trim() || "";
  const headers: HeadersInit = { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const queries = [
    queryUrl("media-assets", documentId, "asset", { "filters[visibility][$eq]": "public" }),
    queryUrl("people", documentId, "photo", { "filters[active][$eq]": "true" }),
    queryUrl("endorsements", documentId, "photo", { "filters[active][$eq]": "true" }),
    queryUrl("episodes", documentId, "audio"),
    queryUrl("episodes", documentId, "featuredImage"),
    queryUrl("posts", documentId, "featuredImage"),
  ];
  const pageUrl = new URL("/api/pages", origin);
  pageUrl.searchParams.set("status", "published");
  pageUrl.searchParams.set("populate[sections][populate]", "*");
  pageUrl.searchParams.set("pagination[pageSize]", "100");
  queries.push(pageUrl);
  const settingsUrl = new URL("/api/site-setting", origin);
  settingsUrl.searchParams.set("status", "published");
  settingsUrl.searchParams.set("populate", "*");
  queries.push(settingsUrl);
  for (const url of queries) {
    const payload = await fetchStrapiJsonOrNull<unknown>(url, {
      headers,
      next: { revalidate: 300, tags: ["strapi-public-media", `strapi-public-media-${documentId}`] },
    }, { label: "Published Strapi media authorization" });
    const media = findMediaNode(payload, documentId);
    if (media) return media;
  }
  return null;
}

export function resolveCmsMediaPath(filename: string, root = process.env.STRAPI_MEDIA_ROOT || "/mnt/storage/pastorwood-media/strapi/uploads") {
  if (!filename || filename !== path.basename(filename) || filename === "." || filename === ".." || /[\u0000-\u001f]/.test(filename)) return null;
  const resolvedRoot = path.resolve(root);
  const filePath = path.resolve(resolvedRoot, filename);
  return filePath.startsWith(`${resolvedRoot}${path.sep}`) ? { root: resolvedRoot, filePath } : null;
}
