import "server-only";

import type { CurrentAppUser } from "@/lib/rbac";
import type { StrapiMedia, StrapiPageSection } from "@/lib/strapi";
import { fetchWithTimeout } from "@/lib/strapi-request";

export type StrapiPublicationStatus = "draft" | "published";

export type ManagedStrapiPage = {
  id?: number;
  documentId: string;
  pageKey: string;
  slug: string;
  title: string;
  active: boolean;
  showInNavigation: boolean;
  navigationLabel: string;
  navigationOrder: number | null;
  heroLabel: string;
  heroTitle: string;
  heroBody: string;
  seoTitle: string;
  seoDescription: string;
  publishedAt: string;
  updatedAt: string;
  createdAt: string;
  archivedAt: string;
  archiveReason: string;
  sections: StrapiPageSection[];
  publicationStatus: StrapiPublicationStatus;
};

export type ManagedStrapiPageRevision = {
  documentId: string;
  revisionNumber: number;
  action: string;
  actorEmail: string;
  actorName: string;
  note: string;
  snapshot: Record<string, unknown>;
  createdAt: string;
};

export type ManagedStrapiPageInput = {
  pageKey: string;
  slug: string;
  title: string;
  active: boolean;
  showInNavigation: boolean;
  navigationLabel: string;
  navigationOrder: number | null;
  heroLabel: string;
  heroTitle: string;
  heroBody: string;
  seoTitle: string;
  seoDescription: string;
  sections: Array<Record<string, unknown>>;
};

type StrapiEntity<T> = {
  id?: number;
  documentId?: string;
  attributes?: Partial<T>;
} & Partial<T>;

type StrapiListResponse<T> = {
  data?: Array<StrapiEntity<T>>;
};

type StrapiSingleResponse<T> = {
  data?: StrapiEntity<T>;
};

function strapiBaseUrl() {
  return process.env.STRAPI_URL?.replace(/\/+$/, "") || "";
}

function strapiWriteToken() {
  return process.env.STRAPI_API_TOKEN_TEMP_WRITE?.trim() || process.env.STRAPI_API_TOKEN?.trim() || "";
}

function headers(): HeadersInit {
  const token = strapiWriteToken();
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

function requireConfig() {
  const baseUrl = strapiBaseUrl();
  const token = strapiWriteToken();

  if (!baseUrl || !token) {
    throw new Error("Strapi management is not configured. Set STRAPI_URL and STRAPI_API_TOKEN_TEMP_WRITE or STRAPI_API_TOKEN.");
  }

  return baseUrl;
}

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeMedia(media: unknown): StrapiMedia | null {
  if (!media || typeof media !== "object") {
    return null;
  }

  const entity = media as Record<string, unknown>;
  const source = asRecord(entity.attributes ?? entity);
  const rawUrl = getString(source.url);

  if (!rawUrl) {
    return null;
  }

  const baseUrl = strapiBaseUrl();
  const url = rawUrl.startsWith("http") || !baseUrl ? rawUrl : new URL(rawUrl, baseUrl).toString();

  return {
    id: typeof entity.id === "number" ? entity.id : undefined,
    url,
    alternativeText: getString(source.alternativeText),
    name: getString(source.name),
  };
}

function normalizeSection(section: unknown): StrapiPageSection | null {
  const source = asRecord(section);
  const component = getString(source.__component);
  const imageSide = getString(source.imageSide);

  if (!component) {
    return null;
  }

  return {
    id: typeof source.id === "number" ? source.id : undefined,
    component,
    eyebrow: getString(source.eyebrow),
    heading: getString(source.heading),
    body: getString(source.body),
    buttonLabel: getString(source.buttonLabel),
    buttonUrl: getString(source.buttonUrl),
    imageSide: imageSide === "none" || imageSide === "left" || imageSide === "right" ? imageSide : "",
    imageDescription: getString(source.imageDescription),
    image: normalizeMedia(source.image),
  };
}

function normalizePage(entity: StrapiEntity<ManagedStrapiPage>): ManagedStrapiPage | null {
  const source = asRecord(entity.attributes ?? entity);
  const documentId = getString(entity.documentId ?? source.documentId);
  const pageKey = getString(source.pageKey);
  const slug = getString(source.slug);
  const title = getString(source.title);

  if (!documentId || (!pageKey && !slug && !title)) {
    return null;
  }

  const rawSections = Array.isArray(source.sections) ? source.sections : [];

  return {
    id: entity.id,
    documentId,
    pageKey,
    slug,
    title,
    active: getBoolean(source.active, true),
    showInNavigation: getBoolean(source.showInNavigation),
    navigationLabel: getString(source.navigationLabel),
    navigationOrder: getNumber(source.navigationOrder),
    heroLabel: getString(source.heroLabel),
    heroTitle: getString(source.heroTitle),
    heroBody: getString(source.heroBody),
    seoTitle: getString(source.seoTitle),
    seoDescription: getString(source.seoDescription),
    publishedAt: getString(source.publishedAt),
    publicationStatus: getString(source.publishedAt) ? "published" : "draft",
    updatedAt: getString(source.updatedAt),
    createdAt: getString(source.createdAt),
    archivedAt: getString(source.archivedAt),
    archiveReason: getString(source.archiveReason),
    sections: rawSections.flatMap((section) => {
      const normalized = normalizeSection(section);
      return normalized ? [normalized] : [];
    }),
  };
}

async function strapiJson<T>(url: URL | string, init?: RequestInit): Promise<T> {
  const response = await fetchWithTimeout(url, {
    ...init,
    headers: {
      ...headers(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Strapi request failed with ${response.status}: ${text.slice(0, 500)}`);
  }

  return (text ? JSON.parse(text) : null) as T;
}

function mergePublicationState(
  draftEntity: StrapiEntity<ManagedStrapiPage> | undefined,
  publishedEntity: StrapiEntity<ManagedStrapiPage> | undefined,
) {
  const page = normalizePage(draftEntity ?? publishedEntity ?? {});
  if (!page) {
    return null;
  }

  const publishedPage = publishedEntity ? normalizePage(publishedEntity) : null;
  return {
    ...page,
    publishedAt: publishedPage?.publishedAt ?? "",
    publicationStatus: publishedPage ? "published" as const : "draft" as const,
  };
}

function setStatus(url: URL, status: StrapiPublicationStatus) {
  url.searchParams.set("status", status);
  return url;
}

function pagePayload(input: ManagedStrapiPageInput) {
  return {
    data: {
      pageKey: input.pageKey,
      slug: input.slug,
      title: input.title,
      active: input.active,
      showInNavigation: input.showInNavigation,
      navigationLabel: input.navigationLabel,
      navigationOrder: input.navigationOrder,
      heroLabel: input.heroLabel,
      heroTitle: input.heroTitle,
      heroBody: input.heroBody,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      sections: input.sections,
    },
  };
}

export async function listManagedStrapiPages() {
  const baseUrl = requireConfig();
  const createUrl = (status: StrapiPublicationStatus) => {
    const url = setStatus(new URL("/api/pages", baseUrl), status);
    url.searchParams.set("pagination[pageSize]", "100");
    url.searchParams.set("sort[0]", "navigationOrder:asc");
    url.searchParams.set("sort[1]", "title:asc");
    url.searchParams.set("populate[sections][populate]", "*");
    return url;
  };

  const [draftPayload, publishedPayload] = await Promise.all([
    strapiJson<StrapiListResponse<ManagedStrapiPage>>(createUrl("draft")),
    strapiJson<StrapiListResponse<ManagedStrapiPage>>(createUrl("published")),
  ]);
  const publishedByDocumentId = new Map(
    (publishedPayload.data ?? []).map((entity) => [getString(entity.documentId), entity]),
  );

  return (draftPayload.data ?? []).flatMap((entity) => {
    const page = mergePublicationState(entity, publishedByDocumentId.get(getString(entity.documentId)));
    return page ? [page] : [];
  });
}

export async function getManagedStrapiPage(documentId: string) {
  const baseUrl = requireConfig();
  const createUrl = (status: StrapiPublicationStatus) => {
    const url = setStatus(new URL(`/api/pages/${documentId}`, baseUrl), status);
    url.searchParams.set("populate[sections][populate]", "*");
    return url;
  };

  const draftPayload = await strapiJson<StrapiSingleResponse<ManagedStrapiPage>>(createUrl("draft"));
  let publishedPayload: StrapiSingleResponse<ManagedStrapiPage> = {};
  try {
    publishedPayload = await strapiJson<StrapiSingleResponse<ManagedStrapiPage>>(createUrl("published"));
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("404")) {
      throw error;
    }
  }

  return mergePublicationState(draftPayload.data, publishedPayload.data);
}

export async function createManagedStrapiPage(
  input: ManagedStrapiPageInput,
  status: StrapiPublicationStatus = "draft",
) {
  const baseUrl = requireConfig();
  const url = setStatus(new URL("/api/pages", baseUrl), status);
  const payload = await strapiJson<StrapiSingleResponse<ManagedStrapiPage>>(url, {
    method: "POST",
    body: JSON.stringify(pagePayload(input)),
  });
  const page = payload.data ? normalizePage(payload.data) : null;

  if (!page) {
    throw new Error("Strapi did not return the created page.");
  }

  return page;
}

export async function updateManagedStrapiPage(
  documentId: string,
  input: ManagedStrapiPageInput,
  status: StrapiPublicationStatus = "draft",
) {
  const baseUrl = requireConfig();
  const url = setStatus(new URL(`/api/pages/${documentId}`, baseUrl), status);
  const payload = await strapiJson<StrapiSingleResponse<ManagedStrapiPage>>(url, {
    method: "PUT",
    body: JSON.stringify(pagePayload(input)),
  });
  const page = payload.data ? normalizePage(payload.data) : null;

  if (!page) {
    throw new Error("Strapi did not return the updated page.");
  }

  return page;
}

export async function unpublishManagedStrapiPage(documentId: string) {
  const baseUrl = requireConfig();
  const url = setStatus(new URL(`/api/pages/${documentId}`, baseUrl), "published");
  await strapiJson<null>(url, { method: "DELETE" });
  const draft = await getManagedStrapiPage(documentId);

  if (!draft) {
    throw new Error("The page was unpublished, but its draft could not be reloaded.");
  }

  return draft;
}

function editorialActor(user: CurrentAppUser) {
  return {
    id: user.clerkUserId,
    email: user.email,
    name: user.name,
  };
}

async function editorialPageRequest(
  path: string,
  method: "POST" | "PUT" | "GET",
  body?: Record<string, unknown>,
) {
  const baseUrl = requireConfig();
  return strapiJson<StrapiSingleResponse<ManagedStrapiPage> | StrapiListResponse<Record<string, unknown>>>(
    new URL(path, baseUrl),
    {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
}

export async function createManagedStrapiPageWithWorkflow(
  input: ManagedStrapiPageInput,
  user: CurrentAppUser,
  note = "",
) {
  const payload = await editorialPageRequest("/api/editorial/page", "POST", {
    data: pagePayload(input).data,
    actor: editorialActor(user),
    note,
  }) as StrapiSingleResponse<ManagedStrapiPage>;
  const page = payload.data ? normalizePage(payload.data) : null;
  if (!page) {
    throw new Error("Strapi did not return the created page.");
  }
  return page;
}

export async function updateManagedStrapiPageWithWorkflow(
  documentId: string,
  input: ManagedStrapiPageInput,
  user: CurrentAppUser,
  note = "",
) {
  const payload = await editorialPageRequest(
    `/api/editorial/page/${encodeURIComponent(documentId)}`,
    "PUT",
    { data: pagePayload(input).data, actor: editorialActor(user), note },
  ) as StrapiSingleResponse<ManagedStrapiPage>;
  const page = payload.data ? normalizePage(payload.data) : null;
  if (!page) {
    throw new Error("Strapi did not return the updated page.");
  }
  return page;
}

export async function transitionManagedStrapiPage(
  documentId: string,
  action: "publish" | "unpublish" | "archive" | "restore" | "delete",
  user: CurrentAppUser,
  note = "",
  expectedTitle = "",
) {
  return editorialPageRequest(
    `/api/editorial/page/${encodeURIComponent(documentId)}/${action}`,
    "POST",
    { actor: editorialActor(user), note, ...(expectedTitle ? { expectedTitle } : {}) },
  );
}

export async function rollbackManagedStrapiPage(
  documentId: string,
  revisionDocumentId: string,
  user: CurrentAppUser,
  note = "",
) {
  return editorialPageRequest(
    `/api/editorial/page/${encodeURIComponent(documentId)}/rollback`,
    "POST",
    { actor: editorialActor(user), note, revisionDocumentId },
  );
}

export async function listManagedStrapiPageRevisions(documentId: string): Promise<ManagedStrapiPageRevision[]> {
  const revisions: ManagedStrapiPageRevision[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const payload = await editorialPageRequest(
      `/api/editorial/page/${encodeURIComponent(documentId)}/revisions?page=${page}`,
      "GET",
    ) as StrapiListResponse<Record<string, unknown>>;
    const batch = payload.data ?? [];
    revisions.push(...batch.flatMap((entity) => {
      const source = asRecord(entity.attributes ?? entity);
      const revisionDocumentId = getString(entity.documentId ?? source.documentId);
      if (!revisionDocumentId) {
        return [];
      }
      return [{
        documentId: revisionDocumentId,
        revisionNumber: getNumber(source.revisionNumber) ?? 0,
        action: getString(source.action),
        actorEmail: getString(source.actorEmail),
        actorName: getString(source.actorName),
        note: getString(source.note),
        snapshot: asRecord(source.snapshot),
        createdAt: getString(source.createdAt),
      }];
    }));
    if (batch.length < 100) {
      return revisions;
    }
  }
  throw new Error("Revision history exceeds the supported 10,000-item safety bound.");
}
