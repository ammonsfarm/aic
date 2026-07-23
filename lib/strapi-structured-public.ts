import "server-only";

import { safeCmsImageSrc } from "@/lib/cms-html";
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
  available: boolean;
};

export type PublishedLookupResult<T> =
  | { status: "found"; item: T }
  | { status: "not-found" }
  | { status: "unavailable" };

type PublicEntryPage = PublishedPage<PublicEntry>;

const STRAPI_MAX_PAGE_SIZE = 100;

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

function strapiPageSize(value: number | undefined) {
  const normalized = typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : STRAPI_MAX_PAGE_SIZE;
  return Math.min(Math.max(normalized, 1), STRAPI_MAX_PAGE_SIZE);
}

async function publishedCollectionPage(
  key: StructuredCollectionKey,
  options: {
    filters?: Record<string, string | boolean>;
    containsAny?: { fields: readonly string[]; value: string };
    ranges?: Array<{ field: string; operator: "gte" | "gt" | "lte" | "lt"; value: string }>;
    sort?: string;
    pageSize?: number;
    page?: number;
  } = {},
): Promise<PublicEntryPage> {
  const requestedPage = Math.max(1, Math.floor(options.page || 1));
  const requestedPageSize = strapiPageSize(options.pageSize);
  const empty = { items: [], page: requestedPage, pageSize: requestedPageSize, pageCount: 0, total: 0, available: false };
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
  if (options.containsAny?.value) {
    options.containsAny.fields.forEach((field, index) => {
      query.set(`filters[$or][${index}][${field}][$containsi]`, options.containsAny?.value || "");
    });
  }
  for (const range of options.ranges || []) {
    query.set(`filters[${range.field}][$${range.operator}]`, range.value);
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
    if (!Array.isArray(payload.data) || !pagination) {
      console.error(`Published Strapi ${key} lookup returned malformed collection data.`);
      return empty;
    }
    const pageNumber = Number(pagination.page);
    const pageSize = Number(pagination.pageSize);
    const pageCount = Number(pagination.pageCount);
    const total = Number(pagination.total);
    if (
      !Number.isSafeInteger(pageNumber) || pageNumber < 1 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 ||
      !Number.isSafeInteger(pageCount) || pageCount < 0 ||
      !Number.isSafeInteger(total) || total < 0 ||
      (total > 0 && pageCount === 0)
    ) {
      console.error(`Published Strapi ${key} lookup returned malformed pagination data.`);
      return empty;
    }
    const normalizedItems = payload.data.map(normalizeEntry);
    if (normalizedItems.some((entry) => !entry)) {
      console.error(`Published Strapi ${key} lookup returned a malformed collection item.`);
      return empty;
    }
    const items = normalizedItems as PublicEntry[];
    return {
      items,
      page: pageNumber,
      pageSize,
      pageCount,
      total,
      available: true,
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
  for (let page = 1; page <= 10_000; page += 1) {
    const result = await publishedCollectionPage(key, { ...options, page, pageSize: STRAPI_MAX_PAGE_SIZE });
    if (!result.available) return [];
    items.push(...result.items);
    if (!result.pageCount || page >= result.pageCount) return items;
  }
  console.error(`Published Strapi ${key} lookup exceeded the complete collection page limit.`);
  return [];
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
    audioUrl: absoluteMediaUrl(entry.audio) || text(entry.externalAudioUrl),
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
  const result = await getPublishedPostBySlugResult(slug);
  return result.status === "found" ? result.item : null;
}

export async function getPublishedPostBySlugResult(slug: string): Promise<PublishedLookupResult<PublishedPost>> {
  const result = await publishedCollectionPage("posts", { filters: { slug }, pageSize: 1 });
  if (!result.available) return { status: "unavailable" };
  if (!result.items[0]) return { status: "not-found" };
  const post = publishedPost(result.items[0]);
  if (!post.title || !post.slug || post.slug !== slug) {
    console.error("Published Strapi post detail lookup returned a malformed item.");
    return { status: "unavailable" };
  }
  return { status: "found", item: post };
}

export async function listAllPublishedPosts(): Promise<PublishedPost[]> {
  return (await allPublishedEntries("posts", { sort: "publishDate:desc" })).map(publishedPost);
}

export async function listLatestPublishedPostsResult(pageSize = STRAPI_MAX_PAGE_SIZE): Promise<{ items: PublishedPost[]; available: boolean }> {
  const result = await publishedCollectionPage("posts", { sort: "publishDate:desc", page: 1, pageSize });
  return { ...result, items: result.items.map(publishedPost) };
}

export async function listPublishedEpisodes(): Promise<PublishedEpisode[]> {
  const entries = await publishedCollection("episodes", { sort: "programDate:desc" });
  return entries.map(publishedEpisode);
}

export async function listPublishedEpisodesPage(
  page = 1,
  pageSize = 24,
  filters: { query?: string; year?: number | null } = {},
): Promise<PublishedPage<PublishedEpisode>> {
  const query = Array.from((filters.query || "").trim()).slice(0, 80).join("");
  const year = Number.isSafeInteger(filters.year) && Number(filters.year) >= 1900 && Number(filters.year) <= 2100
    ? Number(filters.year)
    : null;
  const result = await publishedCollectionPage("episodes", {
    sort: "programDate:desc",
    page,
    pageSize,
    containsAny: query ? { fields: ["title", "summary", "description", "trackId"], value: query } : undefined,
    ranges: year ? [
      { field: "programDate", operator: "gte", value: `${year}-01-01` },
      { field: "programDate", operator: "lt", value: `${year + 1}-01-01` },
    ] : undefined,
  });
  return { ...result, items: result.items.map(publishedEpisode) };
}

export async function getPublishedEpisodeBySlug(slug: string) {
  const result = await getPublishedEpisodeBySlugResult(slug);
  return result.status === "found" ? result.item : null;
}

async function publishedEpisodeLookupResult(filters: Record<string, string>): Promise<PublishedLookupResult<PublishedEpisode>> {
  const result = await publishedCollectionPage("episodes", { filters, pageSize: 1 });
  if (!result.available) return { status: "unavailable" };
  if (!result.items[0]) return { status: "not-found" };
  const episode = publishedEpisode(result.items[0]);
  if (
    !episode.title || !episode.slug || !episode.trackId ||
    (filters.slug !== undefined && episode.slug !== filters.slug) ||
    (filters.trackId !== undefined && episode.trackId !== filters.trackId)
  ) {
    console.error("Published Strapi episode detail lookup returned a malformed item.");
    return { status: "unavailable" };
  }
  return { status: "found", item: episode };
}

export function getPublishedEpisodeBySlugResult(slug: string): Promise<PublishedLookupResult<PublishedEpisode>> {
  return publishedEpisodeLookupResult({ slug });
}

export async function getPublishedEpisodeByTrackId(trackId: string) {
  const result = await getPublishedEpisodeByTrackIdResult(trackId);
  return result.status === "found" ? result.item : null;
}

export function getPublishedEpisodeByTrackIdResult(trackId: string): Promise<PublishedLookupResult<PublishedEpisode>> {
  return publishedEpisodeLookupResult({ trackId });
}

export async function listAllPublishedEpisodes(): Promise<PublishedEpisode[]> {
  return (await allPublishedEntries("episodes", { sort: "programDate:desc" })).map(publishedEpisode);
}

export async function listPublishedBoardMembers(): Promise<PublishedPerson[]> {
  return (await listPublishedBoardMembersResult()).items;
}

export async function listPublishedBoardMembersResult(): Promise<PublishedPage<PublishedPerson>> {
  const result = await publishedCollectionPage("people", {
    filters: { active: true, showOnBoard: true },
    sort: "sortOrder:asc",
  });
  return {
    ...result,
    items: result.items.map((entry) => ({
      ...entry,
      name: text(entry.name),
      slug: text(entry.slug),
      title: text(entry.title),
      organization: text(entry.organization),
      biography: text(entry.biography),
      photoUrl: absoluteMediaUrl(entry.photo) || safeCmsImageSrc(text(entry.legacyPhotoUrl)),
      sortOrder: number(entry.sortOrder),
    })),
  };
}

export async function listPublishedEndorsements(): Promise<PublishedEndorsement[]> {
  return (await listPublishedEndorsementsResult()).items;
}

export async function listPublishedEndorsementsResult(): Promise<PublishedPage<PublishedEndorsement>> {
  const result = await publishedCollectionPage("endorsements", {
    filters: { active: true },
    sort: "sortOrder:asc",
  });
  return {
    ...result,
    items: result.items.map((entry) => ({
      ...entry,
      quote: text(entry.quote),
      attribution: text(entry.attribution),
      title: text(entry.title),
      organization: text(entry.organization),
      photoUrl: absoluteMediaUrl(entry.photo),
      sortOrder: number(entry.sortOrder),
      featured: Boolean(entry.featured),
    })),
  };
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
