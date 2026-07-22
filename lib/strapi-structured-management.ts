import "server-only";

import {
  getStructuredCollection,
  type StructuredCollectionDefinition,
  type StructuredCollectionKey,
} from "@/lib/structured-content-config";
import type { CurrentAppUser } from "@/lib/rbac";

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

type StrapiEnvelope<T> = {
  data: T;
  meta?: unknown;
};

type EditorialActor = {
  id: string;
  email: string;
  name: string;
};

const LIST_PAGE_SIZE = 100;

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
  const response = await fetch(new URL(path, managementBaseUrl()), {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${managementToken()}`,
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    cache: "no-store",
  });

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

function listPath(definition: StructuredCollectionDefinition, status?: "draft" | "published") {
  const query = new URLSearchParams();
  query.set("pagination[pageSize]", String(LIST_PAGE_SIZE));
  query.set("sort", "updatedAt:desc");
  query.set("populate", "*");
  if (status) {
    query.set("status", status);
  }
  return `/api/${definition.apiPath}?${query.toString()}`;
}

async function listVersion(
  definition: StructuredCollectionDefinition,
  status?: "draft" | "published",
): Promise<StructuredEntry[]> {
  const response = await strapiRequest<StrapiEnvelope<unknown[]>>(listPath(definition, status));
  return (response?.data || [])
    .map((entry) => normalizeEntry(entry, status === "published"))
    .filter((entry): entry is StructuredEntry => Boolean(entry));
}

export async function listStructuredEntries(key: StructuredCollectionKey) {
  const definition = getStructuredCollection(key);
  if (!definition) {
    return [];
  }

  if (!definition.publishable) {
    return listVersion(definition);
  }

  const [drafts, published] = await Promise.all([
    listVersion(definition, "draft"),
    listVersion(definition, "published"),
  ]);
  const publishedById = new Map(published.map((entry) => [entry.documentId, entry]));

  const mergedDrafts: StructuredEntry[] = drafts
    .map((draft) => {
      const live = publishedById.get(draft.documentId);
      publishedById.delete(draft.documentId);
      return {
        ...draft,
        publishedAt: live?.publishedAt || draft.publishedAt || null,
        isPublished: Boolean(live),
      };
    });

  return [...mergedDrafts, ...publishedById.values()]
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}

async function getVersion(
  definition: StructuredCollectionDefinition,
  documentId: string,
  status?: "draft" | "published",
) {
  const query = new URLSearchParams({ populate: "*" });
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
      body: JSON.stringify({ data, actor: actorFor(user), note }),
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
  note = "",
) {
  const definition = getStructuredCollection(key);
  if (!definition) {
    throw new Error("Unsupported structured content type.");
  }

  return strapiRequest<StrapiEnvelope<unknown>>(
    `/api/editorial/${definition.entityType}/${encodeURIComponent(documentId)}/${action}`,
    {
      method: "POST",
      body: JSON.stringify({ actor: actorFor(user), note }),
    },
  );
}

export async function rollbackStructuredEntry(
  key: StructuredCollectionKey,
  documentId: string,
  revisionDocumentId: string,
  user: CurrentAppUser,
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
      body: JSON.stringify({ actor: actorFor(user), note, revisionDocumentId }),
    },
  );
}

export async function listStructuredRevisions(key: StructuredCollectionKey, documentId: string) {
  const definition = getStructuredCollection(key);
  if (!definition) {
    return [];
  }

  const response = await strapiRequest<StrapiEnvelope<unknown[]>>(
    `/api/editorial/${definition.entityType}/${encodeURIComponent(documentId)}/revisions`,
  );

  return (response?.data || []).map((item) => {
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
  });
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
