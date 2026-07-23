import "server-only";

import { safeCmsHref, safeCmsImageSrc } from "@/lib/cms-html";
import { cmsMediaPublicUrl } from "@/lib/cms-media-url";
import {
  getFallbackEpisodeBySlug,
  getFallbackEpisodeByTrackId,
  getFallbackEpisodesPage,
  getFallbackPostBySlug,
  getFallbackPostsPage,
} from "@/lib/pastorwood-public-fallback";
import { STATIC_BOARD_MEMBERS, STATIC_ENDORSEMENTS } from "@/lib/pastorwood-static-fallback";
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
  degraded?: boolean;
};

export type PublishedLookupResult<T> =
  | { status: "found"; item: T; degraded?: boolean }
  | { status: "not-found" }
  | { status: "unavailable" };

type PublicEntryPage = PublishedPage<PublicEntry>;

const STRAPI_MAX_PAGE_SIZE = 100;

export type PublishedPersonReference = {
  documentId: string;
  name: string;
  title: string;
  organization: string;
};

export type PublishedScriptureReference = {
  label: string;
  book: string;
  chapter: number | null;
  verseStart: number | null;
  verseEnd: number | null;
  translation: string;
  url: string;
};

export type PublishedExternalLink = {
  label: string;
  url: string;
  description: string;
};

export type PublishedStructuredSeo = {
  title: string;
  description: string;
  canonicalUrl: string;
  noIndex: boolean;
  socialImageUrl: string;
};

export type PublishedPost = PublicEntry & {
  title: string;
  slug: string;
  contentType: string;
  summary: string;
  body: string;
  publishDate: string | null;
  author: PublishedPersonReference | null;
  scriptureReferences: PublishedScriptureReference[];
  relatedLinks: PublishedExternalLink[];
  featuredImageUrl: string;
  featuredImageAlt: string;
  featuredImageCaption: string;
  seo: PublishedStructuredSeo;
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
  guests: PublishedPersonReference[];
  scriptureReferences: PublishedScriptureReference[];
  featuredImageUrl: string;
  featuredImageAlt: string;
  featuredImageCaption: string;
  seo: PublishedStructuredSeo;
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

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    return recordValue(record.data);
  }
  if (record.attributes && typeof record.attributes === "object") {
    return { ...(record.attributes as Record<string, unknown>), ...record };
  }
  return record;
}

function recordValues(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(recordValues);
  if (!value || typeof value !== "object") return [];
  const raw = value as Record<string, unknown>;
  if ("data" in raw) return recordValues(raw.data);
  const record = recordValue(value);
  return record ? [record] : [];
}

function media(value: unknown) {
  return recordValue(value);
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

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function safePublicContentUrl(value: unknown) {
  const safe = safeCmsHref(text(value));
  return safe.startsWith("/") || safe.startsWith("https://") ? safe : "";
}

function people(value: unknown): PublishedPersonReference[] {
  return recordValues(value).flatMap((person) => {
    const name = text(person.name).trim();
    if (!name) return [];
    return [{
      documentId: text(person.documentId),
      name,
      title: text(person.title),
      organization: text(person.organization),
    }];
  });
}

function scriptureReferences(value: unknown): PublishedScriptureReference[] {
  return recordValues(value).flatMap((reference) => {
    const label = text(reference.label).trim();
    if (!label) return [];
    return [{
      label,
      book: text(reference.book),
      chapter: positiveInteger(reference.chapter),
      verseStart: positiveInteger(reference.verseStart),
      verseEnd: positiveInteger(reference.verseEnd),
      translation: text(reference.translation),
      url: safePublicContentUrl(reference.url),
    }];
  });
}

function externalLinks(value: unknown): PublishedExternalLink[] {
  return recordValues(value).flatMap((link) => {
    const label = text(link.label).trim();
    const url = safePublicContentUrl(link.url);
    if (!label || !url) return [];
    return [{ label, url, description: text(link.description) }];
  });
}

function featuredImage(value: unknown, fallbackAlt: string) {
  const image = media(value);
  return {
    url: absoluteMediaUrl(image),
    alt: text(image?.alternativeText).trim() || fallbackAlt,
    caption: text(image?.caption).trim(),
  };
}

function structuredSeo(value: unknown): PublishedStructuredSeo {
  const seo = recordValue(value);
  return {
    title: text(seo?.title).trim(),
    description: text(seo?.description).trim(),
    canonicalUrl: safePublicContentUrl(seo?.canonicalUrl),
    noIndex: seo?.noIndex === true,
    socialImageUrl: absoluteMediaUrl(seo?.socialImage),
  };
}

function addPublicPopulate(query: URLSearchParams, definition: (typeof STRUCTURED_COLLECTIONS)[StructuredCollectionKey]) {
  for (const field of definition.fields) {
    if (field.type === "seo") {
      query.set(`populate[${field.name}][populate]`, "*");
    } else if (field.type === "relation" || field.type === "scripture" || field.type === "external-links") {
      query.set(`populate[${field.name}]`, "*");
    } else if (field.type === "file" && field.mediaTarget) {
      query.set(`populate[${field.mediaTarget}]`, "*");
    }
  }
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
  addPublicPopulate(query, definition);
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

function publishedPost(entry: PublicEntry): PublishedPost {
  const title = text(entry.title);
  const image = featuredImage(entry.featuredImage, title);
  return {
    ...entry,
    title,
    slug: text(entry.slug),
    contentType: text(entry.contentType),
    summary: text(entry.summary),
    body: text(entry.body),
    publishDate: text(entry.publishDate) || null,
    author: people(entry.author)[0] || null,
    scriptureReferences: scriptureReferences(entry.scriptureReferences),
    relatedLinks: externalLinks(entry.relatedLinks),
    featuredImageUrl: image.url,
    featuredImageAlt: image.alt,
    featuredImageCaption: image.caption,
    seo: structuredSeo(entry.seo),
  };
}

function publishedEpisode(entry: PublicEntry): PublishedEpisode {
  const title = text(entry.title);
  const image = featuredImage(entry.featuredImage, title);
  return {
    ...entry,
    title,
    slug: text(entry.slug),
    trackId: text(entry.trackId),
    programDate: text(entry.programDate) || null,
    summary: text(entry.summary),
    description: text(entry.description),
    audioUrl: absoluteMediaUrl(entry.audio) || safePublicContentUrl(entry.externalAudioUrl),
    durationSeconds: entry.durationSeconds === null || entry.durationSeconds === undefined ? null : number(entry.durationSeconds),
    guests: people(entry.guests),
    scriptureReferences: scriptureReferences(entry.scriptureReferences),
    featuredImageUrl: image.url,
    featuredImageAlt: image.alt,
    featuredImageCaption: image.caption,
    seo: structuredSeo(entry.seo),
  };
}

function fallbackPost(entry: Awaited<ReturnType<typeof getFallbackPostBySlug>> & object): PublishedPost {
  return {
    ...entry,
    author: null,
    scriptureReferences: [],
    relatedLinks: [],
    featuredImageUrl: "",
    featuredImageAlt: "",
    featuredImageCaption: "",
    seo: { title: "", description: "", canonicalUrl: "", noIndex: false, socialImageUrl: "" },
  };
}

function fallbackEpisode(entry: NonNullable<Awaited<ReturnType<typeof getFallbackEpisodeBySlug>>>): PublishedEpisode {
  return {
    ...entry,
    guests: [],
    scriptureReferences: [],
    featuredImageUrl: "",
    featuredImageAlt: "",
    featuredImageCaption: "",
    seo: { title: "", description: "", canonicalUrl: "", noIndex: false, socialImageUrl: "" },
  };
}

export async function listPublishedPosts(contentType?: string): Promise<PublishedPost[]> {
  return (await listPublishedPostsPage(contentType, 1, STRAPI_MAX_PAGE_SIZE)).items;
}

export async function listPublishedPostsPage(contentType: string | undefined, page = 1, pageSize = 24): Promise<PublishedPage<PublishedPost>> {
  const result = await publishedCollectionPage("posts", { filters: contentType ? { contentType } : undefined, sort: "publishDate:desc", page, pageSize });
  if (result.available) return { ...result, items: result.items.map(publishedPost) };
  try {
    const fallback = await getFallbackPostsPage(contentType, page, pageSize);
    return { ...fallback, items: fallback.items.map(fallbackPost), available: true, degraded: true };
  } catch (error) {
    console.error("Published post fallback lookup failed.", error);
    return { ...result, items: [] };
  }
}

export async function getPublishedPostBySlug(slug: string) {
  const result = await getPublishedPostBySlugResult(slug);
  return result.status === "found" ? result.item : null;
}

export async function getPublishedPostBySlugResult(slug: string): Promise<PublishedLookupResult<PublishedPost>> {
  const result = await publishedCollectionPage("posts", { filters: { slug }, pageSize: 1 });
  if (!result.available) {
    try {
      const fallback = await getFallbackPostBySlug(slug);
      return fallback ? { status: "found", item: fallbackPost(fallback), degraded: true } : { status: "unavailable" };
    } catch (error) {
      console.error("Published post detail fallback lookup failed.", error);
      return { status: "unavailable" };
    }
  }
  if (!result.items[0]) return { status: "not-found" };
  const post = publishedPost(result.items[0]);
  if (!post.title || !post.slug || post.slug !== slug) {
    console.error("Published Strapi post detail lookup returned a malformed item.");
    return { status: "unavailable" };
  }
  return { status: "found", item: post };
}

async function listAllFallbackPosts(firstPage?: Pick<PublishedPage<PublishedPost>, "items" | "pageCount">): Promise<PublishedPost[]> {
  const fallbackFirst = firstPage ? null : await getFallbackPostsPage(undefined, 1, STRAPI_MAX_PAGE_SIZE);
  const first = firstPage || {
    items: (fallbackFirst?.items || []).map(fallbackPost),
    pageCount: fallbackFirst?.pageCount || 0,
  };
  const items: PublishedPost[] = [...first.items];
  for (let page = 2; page <= first.pageCount; page += 1) {
    items.push(...(await getFallbackPostsPage(undefined, page, STRAPI_MAX_PAGE_SIZE)).items.map(fallbackPost));
  }
  return items;
}

export async function listAllPublishedPosts(): Promise<PublishedPost[]> {
  const first = await listPublishedPostsPage(undefined, 1, STRAPI_MAX_PAGE_SIZE);
  if (first.degraded) return listAllFallbackPosts(first);
  const items = [...first.items];
  for (let page = 2; page <= first.pageCount; page += 1) {
    const next = await listPublishedPostsPage(undefined, page, STRAPI_MAX_PAGE_SIZE);
    if (next.degraded) return listAllFallbackPosts();
    items.push(...next.items);
  }
  return items;
}

export async function listLatestPublishedPostsResult(pageSize = STRAPI_MAX_PAGE_SIZE): Promise<PublishedPage<PublishedPost>> {
  return listPublishedPostsPage(undefined, 1, pageSize);
}

export async function listPublishedEpisodes(): Promise<PublishedEpisode[]> {
  return (await listPublishedEpisodesPage(1, STRAPI_MAX_PAGE_SIZE)).items;
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
  if (result.available) return { ...result, items: result.items.map(publishedEpisode) };
  try {
    const fallback = await getFallbackEpisodesPage(page, pageSize, { query, year });
    return { ...fallback, items: fallback.items.map(fallbackEpisode), available: true, degraded: true };
  } catch (error) {
    console.error("Published episode fallback lookup failed.", error);
    return { ...result, items: [] };
  }
}

export async function getPublishedEpisodeBySlug(slug: string) {
  const result = await getPublishedEpisodeBySlugResult(slug);
  return result.status === "found" ? result.item : null;
}

async function publishedEpisodeLookupResult(filters: Record<string, string>): Promise<PublishedLookupResult<PublishedEpisode>> {
  const result = await publishedCollectionPage("episodes", { filters, pageSize: 1 });
  if (!result.available) {
    try {
      const fallback = filters.slug !== undefined
        ? await getFallbackEpisodeBySlug(filters.slug)
        : await getFallbackEpisodeByTrackId(filters.trackId || "");
      return fallback ? { status: "found", item: fallbackEpisode(fallback), degraded: true } : { status: "unavailable" };
    } catch (error) {
      console.error("Published episode detail fallback lookup failed.", error);
      return { status: "unavailable" };
    }
  }
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

async function listAllFallbackEpisodes(firstPage?: Pick<PublishedPage<PublishedEpisode>, "items" | "pageCount">): Promise<PublishedEpisode[]> {
  const fallbackFirst = firstPage ? null : await getFallbackEpisodesPage(1, STRAPI_MAX_PAGE_SIZE);
  const first = firstPage || {
    items: (fallbackFirst?.items || []).map(fallbackEpisode),
    pageCount: fallbackFirst?.pageCount || 0,
  };
  const items: PublishedEpisode[] = [...first.items];
  for (let page = 2; page <= first.pageCount; page += 1) {
    items.push(...(await getFallbackEpisodesPage(page, STRAPI_MAX_PAGE_SIZE)).items.map(fallbackEpisode));
  }
  return items;
}

export async function listAllPublishedEpisodes(): Promise<PublishedEpisode[]> {
  const first = await listPublishedEpisodesPage(1, STRAPI_MAX_PAGE_SIZE);
  if (first.degraded) return listAllFallbackEpisodes(first);
  const items = [...first.items];
  for (let page = 2; page <= first.pageCount; page += 1) {
    const next = await listPublishedEpisodesPage(page, STRAPI_MAX_PAGE_SIZE);
    if (next.degraded) return listAllFallbackEpisodes();
    items.push(...next.items);
  }
  return items;
}

export async function listPublishedBoardMembers(): Promise<PublishedPerson[]> {
  return (await listPublishedBoardMembersResult()).items;
}

export async function listPublishedBoardMembersResult(): Promise<PublishedPage<PublishedPerson>> {
  const result = await publishedCollectionPage("people", {
    filters: { active: true, showOnBoard: true },
    sort: "sortOrder:asc",
  });
  if (!result.available) {
    return {
      items: STATIC_BOARD_MEMBERS.map((member, index) => ({
        documentId: `static-board-member-${index + 1}`,
        ...member,
        slug: "",
        photoUrl: "",
        sortOrder: index + 1,
      })),
      page: 1,
      pageSize: STATIC_BOARD_MEMBERS.length,
      pageCount: 1,
      total: STATIC_BOARD_MEMBERS.length,
      available: true,
      degraded: true,
    };
  }
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
  if (!result.available) {
    return {
      items: STATIC_ENDORSEMENTS.map((endorsement, index) => ({
        documentId: `static-endorsement-${index + 1}`,
        ...endorsement,
        photoUrl: "",
        sortOrder: index + 1,
      })),
      page: 1,
      pageSize: STATIC_ENDORSEMENTS.length,
      pageCount: 1,
      total: STATIC_ENDORSEMENTS.length,
      available: true,
      degraded: true,
    };
  }
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
