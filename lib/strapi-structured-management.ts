import "server-only";

import {
  getStructuredCollection,
  type StructuredCollectionDefinition,
  type StructuredCollectionKey,
} from "@/lib/structured-content-config";
import type { CurrentAppUser } from "@/lib/rbac";
import { fetchWithTimeout, strapiUploadTimeoutMs } from "@/lib/strapi-request";

export type StructuredEntry = {
  id?: number;
  documentId: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string | null;
  isPublished: boolean;
  [key: string]: unknown;
};

export type StructuredRevision = {
  documentId: string;
  revisionNumber: number;
  action: string;
  actorEmail: string;
  actorName?: string;
  note?: string;
  snapshot: Record<string, unknown>;
  createdAt?: string;
};

export type EpisodeProcessingRequest = {
  documentId: string;
  episodeDocumentId: string;
  trackId: string;
  revisionNumber: number;
  status: "queued" | "running" | "completed" | "failed" | "superseded";
  attemptCount: number;
  nextAttemptAt?: string;
  claimedAt?: string;
  lastError: string;
  result: Record<string, unknown>;
  completedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type EpisodeReprocessContext = {
  episode: StructuredEntry;
  processing: EpisodeProcessingRequest | null;
};

type StrapiEnvelope<T> = {
  data: T;
  meta?: {
    pagination?: Partial<StructuredPagination>;
  };
};

type EditorialActor = {
  id: string;
  email: string;
  name: string;
};

const DEFAULT_LIST_PAGE_SIZE = 50;
const OPERATIONAL_TRACK_ID_PATTERN = /^(?:\d+|sa_\d+|wp-sermon:\d+|cms_[a-z0-9][a-z0-9_-]{0,62})$/;

export type StructuredPagination = {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
};

export type StructuredEntryPage = {
  entries: StructuredEntry[];
  pagination: StructuredPagination;
};

export type StructuredRelationOption = {
  documentId: string;
  label: string;
};

export type ReusableMediaOption = {
  id: number;
  label: string;
  url: string;
  mime: string;
  assetType: string;
  altText: string;
};

export type StructuredInventorySummary = {
  total: number;
  draft: number;
  published: number;
  archived: number;
};

function managementBaseUrl() {
  const value = process.env.STRAPI_MANAGEMENT_URL?.trim() || process.env.STRAPI_URL?.trim() || "";
  if (!value) {
    throw new Error("Structured content is not configured. Set STRAPI_URL or STRAPI_MANAGEMENT_URL.");
  }

  return value.replace(/\/+$/, "");
}

function managementToken() {
  const value =
    process.env.STRAPI_API_TOKEN_TEMP_WRITE?.trim() ||
    process.env.STRAPI_MANAGEMENT_TOKEN?.trim() ||
    process.env.STRAPI_API_TOKEN?.trim() ||
    "";

  if (!value) {
    throw new Error("Structured content writes are not configured. Set a scoped Strapi management token.");
  }

  return value;
}

function actorFor(user: CurrentAppUser): EditorialActor {
  return {
    id: user.clerkUserId,
    email: user.email,
    name: user.name,
  };
}

function normalizeEntry(value: unknown, published = false): StructuredEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const attributes =
    raw.attributes && typeof raw.attributes === "object"
      ? (raw.attributes as Record<string, unknown>)
      : {};
  const merged = { ...attributes, ...raw };
  delete merged.attributes;

  const documentId = typeof merged.documentId === "string" ? merged.documentId : "";
  if (!documentId) {
    return null;
  }

  return {
    ...merged,
    documentId,
    isPublished: published || Boolean(merged.publishedAt),
  } as StructuredEntry;
}

async function strapiRequest<T>(
  path: string,
  init: RequestInit = {},
  options: { allowNotFound?: boolean } = {},
): Promise<T | null> {
  const response = await fetchWithTimeout(new URL(path, managementBaseUrl()), {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${managementToken()}`,
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    cache: "no-store",
  }, init.body instanceof FormData ? strapiUploadTimeoutMs() : undefined);

  const text = await response.text();
  if (options.allowNotFound && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    let detail = text.slice(0, 600);
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      detail = parsed.error?.message || detail;
    } catch {
      // Keep the bounded response text.
    }
    throw new Error(`Strapi request failed (${response.status}): ${detail || response.statusText}`);
  }

  return (text ? JSON.parse(text) : null) as T | null;
}

function searchFields(definition: StructuredCollectionDefinition) {
  if (definition.entityType === "episode") return ["title", "slug", "trackId"];
  if (definition.entityType === "redirect") return ["fromPath", "toPath"];
  return [definition.titleField, definition.slugField].filter((field): field is string => Boolean(field));
}

function addEditorPopulate(query: URLSearchParams, definition: StructuredCollectionDefinition) {
  for (const field of definition.fields) {
    if (field.type === "seo") {
      query.set(`populate[${field.name}][populate][socialImage]`, "true");
    } else if (field.type === "relation" || field.type === "scripture" || field.type === "external-links") {
      query.set(`populate[${field.name}]`, "true");
    } else if (field.type === "file" && field.mediaTarget) {
      query.set(`populate[${field.mediaTarget}]`, "true");
    }
  }
}

function listPath(
  definition: StructuredCollectionDefinition,
  options: {
    status?: "draft" | "published";
    page?: number;
    pageSize?: number;
    search?: string;
    documentIds?: string[];
    archived?: "only" | "exclude";
  } = {},
) {
  const query = new URLSearchParams();
  query.set("pagination[page]", String(options.page ?? 1));
  query.set("pagination[pageSize]", String(options.pageSize ?? DEFAULT_LIST_PAGE_SIZE));
  query.set("sort", "updatedAt:desc");
  query.set("populate", "*");
  if (options.status) {
    query.set("status", options.status);
  }
  const search = options.search?.trim().slice(0, 160) || "";
  if (search) {
    searchFields(definition).forEach((field, index) => {
      query.set(`filters[$or][${index}][${field}][$containsi]`, search);
    });
  }
  options.documentIds?.forEach((documentId, index) => {
    query.set(`filters[documentId][$in][${index}]`, documentId);
  });
  if (options.documentIds) {
    query.set("pagination[pageSize]", String(Math.max(1, options.documentIds.length)));
  }
  if (options.archived === "only") {
    query.set("filters[archivedAt][$notNull]", "true");
  } else if (options.archived === "exclude") {
    query.set("filters[archivedAt][$null]", "true");
  }
  return `/api/${definition.apiPath}?${query.toString()}`;
}

function normalizedPagination(meta: StrapiEnvelope<unknown>["meta"], fallbackPage: number, fallbackPageSize: number): StructuredPagination {
  const pagination = meta?.pagination;
  return {
    page: Number(pagination?.page) || fallbackPage,
    pageSize: Number(pagination?.pageSize) || fallbackPageSize,
    pageCount: Number(pagination?.pageCount) || 0,
    total: Number(pagination?.total) || 0,
  };
}

async function listVersionPage(
  definition: StructuredCollectionDefinition,
  options: {
    status?: "draft" | "published";
    page: number;
    pageSize: number;
    search?: string;
    documentIds?: string[];
    archived?: "only" | "exclude";
  },
): Promise<StructuredEntryPage> {
  const response = await strapiRequest<StrapiEnvelope<unknown[]>>(listPath(definition, options));
  const entries = (response?.data || [])
    .map((entry) => normalizeEntry(entry, options.status === "published"))
    .filter((entry): entry is StructuredEntry => Boolean(entry));
  return {
    entries,
    pagination: normalizedPagination(response?.meta, options.page, options.pageSize),
  };
}

export async function listStructuredEntriesPage(
  key: StructuredCollectionKey,
  options: { page?: number; pageSize?: number; search?: string } = {},
): Promise<StructuredEntryPage> {
  const definition = getStructuredCollection(key);
  if (!definition) {
    return { entries: [], pagination: { page: 1, pageSize: DEFAULT_LIST_PAGE_SIZE, pageCount: 0, total: 0 } };
  }
  const page = Math.max(1, Math.floor(options.page || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize || DEFAULT_LIST_PAGE_SIZE)));
  const search = options.search?.trim().slice(0, 160) || "";

  if (!definition.publishable) {
    return listVersionPage(definition, { page, pageSize, search });
  }

  const drafts = await listVersionPage(definition, { status: "draft", page, pageSize, search });
  const documentIds = drafts.entries.map((entry) => entry.documentId);
  const published = documentIds.length
    ? await listVersionPage(definition, {
        status: "published",
        page: 1,
        pageSize: documentIds.length,
        documentIds,
      })
    : { entries: [], pagination: { page: 1, pageSize, pageCount: 0, total: 0 } };
  const publishedById = new Map(published.entries.map((entry) => [entry.documentId, entry]));

  const mergedDrafts: StructuredEntry[] = drafts.entries
    .map((draft) => {
      const live = publishedById.get(draft.documentId);
      publishedById.delete(draft.documentId);
      return {
        ...draft,
        publishedAt: live?.publishedAt || draft.publishedAt || null,
        isPublished: Boolean(live),
      };
    });

  return {
    entries: [...mergedDrafts, ...publishedById.values()]
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""))),
    pagination: drafts.pagination,
  };
}

export async function getStructuredInventorySummary(
  key: StructuredCollectionKey,
): Promise<StructuredInventorySummary> {
  const definition = getStructuredCollection(key);
  if (!definition) {
    return { total: 0, draft: 0, published: 0, archived: 0 };
  }
  const status = definition.publishable ? "draft" as const : undefined;
  const [all, archived, published] = await Promise.all([
    listVersionPage(definition, { status, page: 1, pageSize: 1 }),
    listVersionPage(definition, { status, page: 1, pageSize: 1, archived: "only" }),
    definition.publishable
      ? listVersionPage(definition, { status: "published", page: 1, pageSize: 1, archived: "exclude" })
      : Promise.resolve({ entries: [], pagination: { page: 1, pageSize: 1, pageCount: 0, total: 0 } }),
  ]);
  const total = all.pagination.total;
  const archivedCount = Math.min(total, archived.pagination.total);
  const publishedCount = Math.min(total - archivedCount, published.pagination.total);
  return {
    total,
    archived: archivedCount,
    published: publishedCount,
    draft: Math.max(0, total - archivedCount - publishedCount),
  };
}

export async function listStructuredPeopleOptions(): Promise<StructuredRelationOption[]> {
  const definition = getStructuredCollection("people");
  if (!definition) {
    return [];
  }

  const options: StructuredRelationOption[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const result = await listVersionPage(definition, {
      status: "draft",
      page,
      pageSize: 100,
      archived: "exclude",
    });
    options.push(...result.entries.map((entry) => ({
      documentId: entry.documentId,
      label: String(entry.name || entry.title || entry.documentId),
    })));
    if (page >= result.pagination.pageCount || result.entries.length < result.pagination.pageSize) {
      return options.sort((left, right) => left.label.localeCompare(right.label));
    }
  }

  throw new Error("People options exceed the supported 1,000-item editor safety bound.");
}

function mediaRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.data && typeof record.data === "object") return mediaRecord(record.data);
  if (record.attributes && typeof record.attributes === "object") {
    return { ...(record.attributes as Record<string, unknown>), ...record };
  }
  return record;
}

export async function listReusableMediaOptions(): Promise<ReusableMediaOption[]> {
  const options: ReusableMediaOption[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const query = new URLSearchParams();
    query.set("status", "published");
    query.set("filters[visibility][$eq]", "public");
    query.set("filters[archivedAt][$null]", "true");
    query.append("populate[0]", "asset");
    query.set("sort", "title:asc");
    query.set("pagination[page]", String(page));
    query.set("pagination[pageSize]", "100");
    const response = await strapiRequest<StrapiEnvelope<unknown[]>>(`/api/media-assets?${query.toString()}`);
    const batch = response?.data || [];
    options.push(...batch.flatMap((item) => {
      const entry = normalizeEntry(item, true);
      const asset = mediaRecord(entry?.asset);
      const id = Number(asset?.id);
      const rawUrl = typeof asset?.url === "string" ? asset.url : "";
      if (!entry || !Number.isSafeInteger(id) || id <= 0 || !rawUrl) return [];
      const url = rawUrl.startsWith("http") ? rawUrl : new URL(rawUrl, managementBaseUrl()).toString();
      return [{
        id,
        label: String(entry.title || asset?.name || `Media ${id}`),
        url,
        mime: String(asset?.mime || entry.mimeType || ""),
        assetType: String(entry.assetType || "other"),
        altText: String(entry.altText || asset?.alternativeText || ""),
      } satisfies ReusableMediaOption];
    }));
    const pagination = normalizedPagination(response?.meta, page, 100);
    if (page >= pagination.pageCount || batch.length < pagination.pageSize) {
      return options.sort((left, right) => left.label.localeCompare(right.label));
    }
  }
  throw new Error("Reusable media exceeds the supported 1,000-item editor safety bound.");
}

export async function assertReusableMediaSelection(fileId: number, accept = "") {
  if (!Number.isSafeInteger(fileId) || fileId <= 0) {
    throw new Error("Choose a valid existing media item.");
  }
  const option = (await listReusableMediaOptions()).find((candidate) => candidate.id === fileId);
  if (!option) {
    throw new Error("The selected media item is not a published public asset or is no longer available.");
  }
  if (accept.includes("image/") && option.assetType !== "image" && !option.mime.startsWith("image/")) {
    throw new Error("The selected media item must be an image.");
  }
  if ((accept.includes("audio/") || accept.includes(".mp3")) && option.assetType !== "audio" && !option.mime.startsWith("audio/")) {
    throw new Error("The selected media item must be audio.");
  }
  if (accept.includes(".mp3") && option.mime && !["audio/mpeg", "audio/mp3", "audio/mpeg3", "audio/x-mpeg-3"].includes(option.mime.toLowerCase())) {
    throw new Error("The selected media item must be an MP3 file.");
  }
  return option;
}

async function getVersion(
  definition: StructuredCollectionDefinition,
  documentId: string,
  status?: "draft" | "published",
) {
  const query = new URLSearchParams();
  addEditorPopulate(query, definition);
  if (status) {
    query.set("status", status);
  }
  const response = await strapiRequest<StrapiEnvelope<unknown>>(
    `/api/${definition.apiPath}/${encodeURIComponent(documentId)}?${query.toString()}`,
    {},
    { allowNotFound: true },
  );
  return normalizeEntry(response?.data, status === "published");
}

export async function getStructuredEntry(key: StructuredCollectionKey, documentId: string) {
  const definition = getStructuredCollection(key);
  if (!definition) {
    return null;
  }

  if (!definition.publishable) {
    return getVersion(definition, documentId);
  }

  const [draft, published] = await Promise.all([
    getVersion(definition, documentId, "draft"),
    getVersion(definition, documentId, "published"),
  ]);
  const entry = draft || published;
  if (!entry) {
    return null;
  }

  return {
    ...entry,
    publishedAt: published?.publishedAt || null,
    isPublished: Boolean(published),
  };
}

function validOperationalTrackId(value: string) {
  const trackId = value.trim();
  if (!trackId || trackId.length > 100 || !OPERATIONAL_TRACK_ID_PATTERN.test(trackId)) {
    throw new Error("This episode has an invalid permanent Track ID.");
  }
  return trackId;
}

async function getStructuredEpisodeByTrackId(trackIdInput: string) {
  const trackId = validOperationalTrackId(trackIdInput);
  const definition = getStructuredCollection("episodes");
  if (!definition) {
    throw new Error("Episode content management is not configured.");
  }

  for (const status of ["draft", "published"] as const) {
    const query = new URLSearchParams();
    query.set("filters[trackId][$eq]", trackId);
    query.set("pagination[pageSize]", "2");
    query.set("status", status);
    addEditorPopulate(query, definition);
    const response = await strapiRequest<StrapiEnvelope<unknown[]>>(
      `/api/${definition.apiPath}?${query.toString()}`,
    );
    const matches = (response?.data || [])
      .map((item) => normalizeEntry(item, status === "published"))
      .filter((item): item is StructuredEntry => Boolean(item));
    if (matches.length > 1) {
      throw new Error(`More than one Strapi episode uses Track ID ${trackId}.`);
    }
    if (matches[0]) {
      return matches[0];
    }
  }

  return null;
}

export async function getEpisodeReprocessContextByTrackId(
  trackId: string,
): Promise<EpisodeReprocessContext | null> {
  const episode = await getStructuredEpisodeByTrackId(trackId);
  if (!episode) {
    return null;
  }
  return {
    episode,
    processing: await getLatestEpisodeProcessingRequest(episode.documentId),
  };
}

export async function queueEpisodeReprocessByTrackId(
  trackId: string,
  user: CurrentAppUser,
  note: string,
) {
  const retryNote = note.trim();
  if (!retryNote) {
    throw new Error("A reprocessing reason is required.");
  }
  if (retryNote.length > 2_000) {
    throw new Error("The reprocessing reason must be 2,000 characters or fewer.");
  }
  const episode = await getStructuredEpisodeByTrackId(trackId);
  if (!episode) {
    throw new Error(`No Strapi episode matches Track ID ${validOperationalTrackId(trackId)}.`);
  }
  if (!episode.updatedAt) {
    throw new Error("The Strapi episode is missing its content version. Reload before reprocessing.");
  }
  await retryEpisodeProcessing(episode.documentId, user, episode.updatedAt, retryNote);
  return episode;
}

export async function createStructuredEntry(
  key: StructuredCollectionKey,
  data: Record<string, unknown>,
  user: CurrentAppUser,
  note = "",
) {
  const definition = getStructuredCollection(key);
  if (!definition) {
    throw new Error("Unsupported structured content type.");
  }

  const response = await strapiRequest<StrapiEnvelope<unknown>>(
    `/api/editorial/${definition.entityType}`,
    {
      method: "POST",
      body: JSON.stringify({ data, actor: actorFor(user), note }),
    },
  );
  const entry = normalizeEntry(response?.data);
  if (!entry) {
    throw new Error("Strapi did not return the created content item.");
  }
  return entry;
}

export async function updateStructuredEntry(
  key: StructuredCollectionKey,
  documentId: string,
  data: Record<string, unknown>,
  user: CurrentAppUser,
  expectedUpdatedAt: string,
  note = "",
) {
  const definition = getStructuredCollection(key);
  if (!definition) {
    throw new Error("Unsupported structured content type.");
  }

  const response = await strapiRequest<StrapiEnvelope<unknown>>(
    `/api/editorial/${definition.entityType}/${encodeURIComponent(documentId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ data, actor: actorFor(user), expectedUpdatedAt, note }),
    },
  );
  const entry = normalizeEntry(response?.data);
  if (!entry) {
    throw new Error("Strapi did not return the updated content item.");
  }
  return entry;
}

export async function transitionStructuredEntry(
  key: StructuredCollectionKey,
  documentId: string,
  action: "publish" | "unpublish" | "archive" | "restore" | "delete",
  user: CurrentAppUser,
  expectedUpdatedAt: string,
  note = "",
  expectedTitle = "",
) {
  const definition = getStructuredCollection(key);
  if (!definition) {
    throw new Error("Unsupported structured content type.");
  }

  return strapiRequest<StrapiEnvelope<unknown>>(
    `/api/editorial/${definition.entityType}/${encodeURIComponent(documentId)}/${action}`,
    {
      method: "POST",
      body: JSON.stringify({
        actor: actorFor(user),
        expectedUpdatedAt,
        note,
        ...(expectedTitle ? { expectedTitle } : {}),
      }),
    },
  );
}

export async function rollbackStructuredEntry(
  key: StructuredCollectionKey,
  documentId: string,
  revisionDocumentId: string,
  user: CurrentAppUser,
  expectedUpdatedAt: string,
  note = "",
) {
  const definition = getStructuredCollection(key);
  if (!definition) {
    throw new Error("Unsupported structured content type.");
  }

  return strapiRequest<StrapiEnvelope<unknown>>(
    `/api/editorial/${definition.entityType}/${encodeURIComponent(documentId)}/rollback`,
    {
      method: "POST",
      body: JSON.stringify({ actor: actorFor(user), expectedUpdatedAt, note, revisionDocumentId }),
    },
  );
}

export async function getLatestEpisodeProcessingRequest(documentId: string): Promise<EpisodeProcessingRequest | null> {
  const query = new URLSearchParams();
  query.set("filters[episodeDocumentId][$eq]", documentId);
  query.set("sort", "createdAt:desc");
  query.set("pagination[pageSize]", "1");
  const response = await strapiRequest<StrapiEnvelope<unknown[]>>(
    `/api/episode-processing-requests?${query.toString()}`,
  );
  const normalized = normalizeEntry(response?.data?.[0]);
  if (!normalized) {
    return null;
  }
  const status = String(normalized.status || "");
  if (!["queued", "running", "completed", "failed", "superseded"].includes(status)) {
    return null;
  }
  return {
    documentId: normalized.documentId,
    episodeDocumentId: String(normalized.episodeDocumentId || ""),
    trackId: String(normalized.trackId || ""),
    revisionNumber: Number(normalized.revisionNumber || 0),
    status: status as EpisodeProcessingRequest["status"],
    attemptCount: Number(normalized.attemptCount || 0),
    nextAttemptAt: typeof normalized.nextAttemptAt === "string" ? normalized.nextAttemptAt : undefined,
    claimedAt: typeof normalized.claimedAt === "string" ? normalized.claimedAt : undefined,
    lastError: String(normalized.lastError || ""),
    result:
      normalized.result && typeof normalized.result === "object"
        ? normalized.result as Record<string, unknown>
        : {},
    completedAt: typeof normalized.completedAt === "string" ? normalized.completedAt : undefined,
    createdAt: typeof normalized.createdAt === "string" ? normalized.createdAt : undefined,
    updatedAt: typeof normalized.updatedAt === "string" ? normalized.updatedAt : undefined,
  };
}

export async function retryEpisodeProcessing(
  documentId: string,
  user: CurrentAppUser,
  expectedUpdatedAt: string,
  note = "",
) {
  return strapiRequest<StrapiEnvelope<unknown>>(
    `/api/editorial/episode/${encodeURIComponent(documentId)}/retry-processing`,
    {
      method: "POST",
      body: JSON.stringify({ actor: actorFor(user), expectedUpdatedAt, note }),
    },
  );
}

export async function listStructuredRevisions(key: StructuredCollectionKey, documentId: string) {
  const definition = getStructuredCollection(key);
  if (!definition) {
    return [];
  }

  const revisions: StructuredRevision[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await strapiRequest<StrapiEnvelope<unknown[]>>(
      `/api/editorial/${definition.entityType}/${encodeURIComponent(documentId)}/revisions?page=${page}`,
    );
    const batch = response?.data || [];
    revisions.push(...batch.map((item) => {
      const normalized = normalizeEntry(item);
      const raw = normalized || (item as Record<string, unknown>);
      return {
        documentId: String(raw.documentId || ""),
        revisionNumber: Number(raw.revisionNumber || 0),
        action: String(raw.action || ""),
        actorEmail: String(raw.actorEmail || ""),
        actorName: String(raw.actorName || ""),
        note: String(raw.note || ""),
        snapshot:
          raw.snapshot && typeof raw.snapshot === "object"
            ? (raw.snapshot as Record<string, unknown>)
            : {},
        createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
      } satisfies StructuredRevision;
    }));
    if (batch.length < 100) {
      return revisions;
    }
  }
  throw new Error("Revision history exceeds the supported 10,000-item safety bound.");
}

export async function uploadStructuredFile(file: File) {
  if (!file.size) {
    return null;
  }

  const upload = new FormData();
  upload.append("files", file, file.name || "content-upload");

  const response = await strapiRequest<Array<{ id?: number; url?: string; name?: string }>>(
    "/api/upload",
    {
      method: "POST",
      body: upload,
    },
  );

  const uploaded = response?.[0];
  if (!uploaded || typeof uploaded.id !== "number") {
    throw new Error("Strapi did not return an uploaded media identifier.");
  }

  return uploaded;
}

export async function deleteStructuredFile(fileId: number) {
  if (!Number.isInteger(fileId) || fileId <= 0) {
    throw new Error("A valid Strapi media identifier is required for cleanup.");
  }

  await strapiRequest(
    `/api/upload/files/${fileId}`,
    { method: "DELETE" },
    { allowNotFound: true },
  );
}

export type StructuredAuditEvent = {
  documentId: string;
  entityType: string;
  entityDocumentId: string;
  entityTitle: string;
  action: string;
  actorEmail: string;
  actorName: string;
  note: string;
  detail: Record<string, unknown>;
  createdAt?: string;
};

export async function listStructuredAuditEvents(limit = 100): Promise<StructuredAuditEvent[]> {
  const query = new URLSearchParams();
  query.set("pagination[pageSize]", String(Math.min(Math.max(limit, 1), 250)));
  query.set("sort", "createdAt:desc");

  const response = await strapiRequest<StrapiEnvelope<unknown[]>>(
    `/api/editorial-events?${query.toString()}`,
  );

  return (response?.data || []).flatMap((item) => {
    const normalized = normalizeEntry(item);
    if (!normalized) {
      return [];
    }

    return [{
      documentId: normalized.documentId,
      entityType: String(normalized.entityType || ""),
      entityDocumentId: String(normalized.entityDocumentId || ""),
      entityTitle: String(normalized.entityTitle || ""),
      action: String(normalized.action || ""),
      actorEmail: String(normalized.actorEmail || ""),
      actorName: String(normalized.actorName || ""),
      note: String(normalized.note || ""),
      detail:
        normalized.detail && typeof normalized.detail === "object"
          ? (normalized.detail as Record<string, unknown>)
          : {},
      createdAt: typeof normalized.createdAt === "string" ? normalized.createdAt : undefined,
    }];
  });
}
