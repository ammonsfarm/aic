import "server-only";

import { cmsMediaPublicUrl } from "@/lib/cms-media-url";
import { STRAPI_STRUCTURED_CACHE_TAG, strapiStructuredCacheTag } from "@/lib/strapi-cache-tags";
import type { StructuredCollectionKey } from "@/lib/structured-content-config";
import { STRUCTURED_COLLECTIONS } from "@/lib/structured-content-config";

type PublicEntry = {
  documentId: string;
  [key: string]: unknown;
};

export type PublishedPage<T> = {
  items: T[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
};

type PublicEntryPage = PublishedPage<PublicEntry>;

export type PublishedPost = PublicEntry & {
  title: string;
  slug: string;
  contentType: string;
  summary: string;
  body: string;
  publishDate: string | null;
};

export type PublishedEpisode = PublicEntry & {
  title: string;
  slug: string;
  trackId: string;
  programDate: string | null;
  summary: string;
  description: string;
  audioUrl: string;
  durationSeconds: number | null;
};

export type PublishedPerson = PublicEntry & {
  name: string;
  slug: string;
  title: string;
  organization: string;
  biography: string;
  photoUrl: string;
  sortOrder: number;
};

export type PublishedEndorsement = PublicEntry & {
  quote: string;
  attribution: string;
  title: string;
  organization: string;
  photoUrl: string;
  sortOrder: number;
  featured: boolean;
};

export type PublishedMediaAsset = PublicEntry & {
  title: string;
  slug: string;
  assetType: string;
  url: string;
  altText: string;
  caption: string;
  credit: string;
};

export type PublicRedirect = PublicEntry & {
  fromPath: string;
  toPath: string;
  statusCode: 301 | 302 | 307 | 308;
};

function baseUrl() {
  return (process.env.STRAPI_PUBLIC_URL?.trim() || process.env.STRAPI_URL?.trim() || "").replace(/\/+$/, "");
}

function readToken() {
  return process.env.STRAPI_READ_TOKEN?.trim() || process.env.STRAPI_API_TOKEN?.trim() || "";
}

function normalizeEntry(value: unknown): PublicEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const attributes =
    raw.attributes && typeof raw.attributes === "object"
      ? (raw.attributes as Record<string, unknown>)
      : {};
  const merged = { ...attributes, ...raw };
  delete merged.attributes;
  if (typeof merged.documentId !== "string") return null;
  return merged as PublicEntry;
}

function media(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.data) return media(record.data);
  if (record.attributes && typeof record.attributes === "object") {
    return { ...(record.attributes as Record<string, unknown>), ...record };
  }
  return record;
}

function absoluteMediaUrl(value: unknown) {
  return cmsMediaPublicUrl(media(value));
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function publishedCollectionPage(
  key: StructuredCollectionKey,
  options: {
    filters?: Record<string, string | boolean>;
    sort?: string;
    pageSize?: number;
    page?: number;
  } = {},
): Promise<PublicEntryPage> {
  const requestedPage = Math.max(1, Math.floor(options.page || 1));
  const requestedPageSize = Math.min(Math.max(options.pageSize || 100, 1), 250);
  const empty = { items: [], page: requestedPage, pageSize: requestedPageSize, pageCount: 0, total: 0 };
  const origin = baseUrl();
  if (!origin) return empty;

  const definition = STRUCTURED_COLLECTIONS[key];
  const query = new URLSearchParams();
  if (definition.publishable) {
    query.set("status", "published");
  }
  query.set("populate", "*");
  query.set("pagination[page]", String(requestedPage));
  query.set("pagination[pageSize]", String(requestedPageSize));
  query.set("sort", options.sort || "updatedAt:desc");
  query.set("filters[archivedAt][$null]", "true");
  for (const [field, value] of Object.entries(options.filters || {})) {
    query.set(`filters[${field}][$eq]`, String(value));
  }

  try {
    const token = readToken();
    const response = await fetch(new URL(`/api/${definition.apiPath}?${query.toString()}`, origin), {
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: {
        revalidate: 300,
        tags: [STRAPI_STRUCTURED_CACHE_TAG, strapiStructuredCacheTag(key)],
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      console.error(`Published Strapi ${key} lookup failed with ${response.status}.`);
      return empty;
    }

    const payload = (await response.json()) as {
      data?: unknown[];
      meta?: { pagination?: { page?: number; pageSize?: number; pageCount?: number; total?: number } };
    };
    const pagination = payload.meta?.pagination;
    const items = (payload.data || [])
      .map(normalizeEntry)
      .filter((entry): entry is PublicEntry => Boolean(entry));
    return {
      items,
      page: number(pagination?.page) || requestedPage,
      pageSize: number(pagination?.pageSize) || requestedPageSize,
      pageCount: number(pagination?.pageCount) || (items.length ? requestedPage : 0),
      total: number(pagination?.total) || items.length,
    };
  } catch (error) {
    console.error(`Published Strapi ${key} lookup failed; using empty fallback.`, error);
    return empty;
  }
}

async function publishedCollection(
  key: StructuredCollectionKey,
  options: Parameters<typeof publishedCollectionPage>[1] = {},
) {
  return (await publishedCollectionPage(key, options)).items;
}

async function allPublishedEntries(key: StructuredCollectionKey, options: Parameters<typeof publishedCollectionPage>[1] = {}) {
  const items: PublicEntry[] = [];
  let page = 1;
  do {
    const result = await publishedCollectionPage(key, { ...options, page, pageSize: 250 });
    items.push(...result.items);
    if (!result.pageCount || page >= result.pageCount) break;
    page += 1;
  } while (page <= 10_000);
  return items;
}

function publishedPost(entry: PublicEntry): PublishedPost {
  return {
    ...entry,
    title: text(entry.title),
    slug: text(entry.slug),
    contentType: text(entry.contentType),
    summary: text(entry.summary),
    body: text(entry.body),
    publishDate: text(entry.publishDate) || null,
  };
}

function publishedEpisode(entry: PublicEntry): PublishedEpisode {
  return {
    ...entry,
    title: text(entry.title),
    slug: text(entry.slug),
    trackId: text(entry.trackId),
    programDate: text(entry.programDate) || null,
    summary: text(entry.summary),
    description: text(entry.description),
    audioUrl: text(entry.externalAudioUrl) || absoluteMediaUrl(entry.audio),
    durationSeconds: entry.durationSeconds === null || entry.durationSeconds === undefined ? null : number(entry.durationSeconds),
  };
}

export async function listPublishedPosts(contentType?: string): Promise<PublishedPost[]> {
  const entries = await publishedCollection("posts", {
    filters: contentType ? { contentType } : undefined,
    sort: "publishDate:desc",
  });
  return entries.map(publishedPost);
}

export async function listPublishedPostsPage(contentType: string | undefined, page = 1, pageSize = 24): Promise<PublishedPage<PublishedPost>> {
  const result = await publishedCollectionPage("posts", { filters: contentType ? { contentType } : undefined, sort: "publishDate:desc", page, pageSize });
  return { ...result, items: result.items.map(publishedPost) };
}

export async function getPublishedPostBySlug(slug: string) {
  const result = await publishedCollectionPage("posts", { filters: { slug }, pageSize: 1 });
  return result.items[0] ? publishedPost(result.items[0]) : null;
}

export async function listAllPublishedPosts(): Promise<PublishedPost[]> {
  return (await allPublishedEntries("posts", { sort: "publishDate:desc" })).map(publishedPost);
}

export async function listPublishedEpisodes(): Promise<PublishedEpisode[]> {
  const entries = await publishedCollection("episodes", { sort: "programDate:desc" });
  return entries.map(publishedEpisode);
}

export async function listPublishedEpisodesPage(page = 1, pageSize = 24): Promise<PublishedPage<PublishedEpisode>> {
  const result = await publishedCollectionPage("episodes", { sort: "programDate:desc", page, pageSize });
  return { ...result, items: result.items.map(publishedEpisode) };
}

export async function getPublishedEpisodeBySlug(slug: string) {
  const result = await publishedCollectionPage("episodes", { filters: { slug }, pageSize: 1 });
  return result.items[0] ? publishedEpisode(result.items[0]) : null;
}

export async function getPublishedEpisodeByTrackId(trackId: string) {
  const result = await publishedCollectionPage("episodes", { filters: { trackId }, pageSize: 1 });
  return result.items[0] ? publishedEpisode(result.items[0]) : null;
}

export async function listAllPublishedEpisodes(): Promise<PublishedEpisode[]> {
  return (await allPublishedEntries("episodes", { sort: "programDate:desc" })).map(publishedEpisode);
}

export async function listPublishedBoardMembers(): Promise<PublishedPerson[]> {
  const entries = await publishedCollection("people", {
    filters: { active: true, showOnBoard: true },
    sort: "sortOrder:asc",
  });
  return entries.map((entry) => ({
    ...entry,
    name: text(entry.name),
    slug: text(entry.slug),
    title: text(entry.title),
    organization: text(entry.organization),
    biography: text(entry.biography),
    photoUrl: absoluteMediaUrl(entry.photo),
    sortOrder: number(entry.sortOrder),
  }));
}

export async function listPublishedEndorsements(): Promise<PublishedEndorsement[]> {
  const entries = await publishedCollection("endorsements", {
    filters: { active: true },
    sort: "sortOrder:asc",
  });
  return entries.map((entry) => ({
    ...entry,
    quote: text(entry.quote),
    attribution: text(entry.attribution),
    title: text(entry.title),
    organization: text(entry.organization),
    photoUrl: absoluteMediaUrl(entry.photo),
    sortOrder: number(entry.sortOrder),
    featured: Boolean(entry.featured),
  }));
}

export async function listPublicMediaAssets(): Promise<PublishedMediaAsset[]> {
  const entries = await publishedCollection("media-assets", {
    filters: { visibility: "public" },
    sort: "title:asc",
  });
  return entries.flatMap((entry) => {
    const url = absoluteMediaUrl(entry.asset);
    if (!url) return [];
    return [{
      ...entry,
      title: text(entry.title),
      slug: text(entry.slug),
      assetType: text(entry.assetType),
      url,
      altText: text(entry.altText),
      caption: text(entry.caption),
      credit: text(entry.credit),
    }];
  });
}

export async function listPublicRedirects(): Promise<PublicRedirect[]> {
  const entries = await publishedCollection("redirects", {
    filters: { active: true },
    sort: "fromPath:asc",
  });
  return entries.flatMap((entry) => {
    const statusCode = Number(entry.statusCode);
    if (![301, 302, 307, 308].includes(statusCode)) return [];
    return [{
      ...entry,
      fromPath: text(entry.fromPath),
      toPath: text(entry.toPath),
      statusCode: statusCode as 301 | 302 | 307 | 308,
    }];
  });
}
