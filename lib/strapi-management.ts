import "server-only";

import type { CurrentAppUser } from "@/lib/rbac";
import { normalizePageFontSize, type PageFontSize } from "@/lib/page-typography";
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
  heroTitleSize: PageFontSize;
  heroBodySize: PageFontSize;
  sectionHeadingSize: PageFontSize;
  sectionBodySize: PageFontSize;
  seoTitle: string;
  seoDescription: string;
  canonicalUrl: string;
  noIndex: boolean;
  socialImage: StrapiMedia | null;
  scheduledFor: string;
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

export type ManagedStrapiPagePagination = {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
};

export type ManagedStrapiPageResult = {
  pages: ManagedStrapiPage[];
  pagination: ManagedStrapiPagePagination;
};

export type ManagedStrapiPageSummary = {
  total: number;
  active: number;
  draft: number;
  published: number;
  archived: number;
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
  heroTitleSize: PageFontSize;
  heroBodySize: PageFontSize;
  sectionHeadingSize: PageFontSize;
  sectionBodySize: PageFontSize;
  seoTitle: string;
  seoDescription: string;
  canonicalUrl?: string;
  noIndex?: boolean;
  socialImage?: number | null;
  scheduledFor?: string | null;
  sections: Array<Record<string, unknown>>;
};

type StrapiEntity<T> = {
  id?: number;
  documentId?: string;
  attributes?: Partial<T>;
} & Partial<T>;

type StrapiListResponse<T> = {
  data?: Array<StrapiEntity<T>>;
  meta?: {
    pagination?: Partial<ManagedStrapiPagePagination>;
  };
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

function protectedMediaPreviewUrl(value: unknown) {
  const source = asRecord(value);
  const rawUrl = getString(source.url);
  if (!rawUrl || rawUrl.startsWith("//")) return "";
  try {
    const absolute = /^https?:\/\//i.test(rawUrl);
    const parsed = new URL(rawUrl, "https://strapi-preview.invalid");
    const baseUrl = strapiBaseUrl();
    const sameStrapi = !absolute || (baseUrl && parsed.origin === new URL(baseUrl).origin);
    if (!sameStrapi || !parsed.pathname.startsWith("/uploads/")) return "";
    const encodedPath = parsed.pathname
      .slice("/uploads/".length)
      .split("/")
      .filter(Boolean)
      .map((part) => encodeURIComponent(decodeURIComponent(part)))
      .join("/");
    return encodedPath ? `/api/content/strapi-media/${encodedPath}` : "";
  } catch {
    return "";
  }
}

function normalizeMedia(media: unknown): StrapiMedia | null {
  if (!media || typeof media !== "object") {
    return null;
  }

  const wrapper = media as Record<string, unknown>;
  const entity = wrapper.data && typeof wrapper.data === "object"
    ? (wrapper.data as Record<string, unknown>)
    : wrapper;
  const source = asRecord(entity.attributes ?? entity);
  const rawUrl = getString(source.url);

  if (!rawUrl) {
    return null;
  }

  const url = protectedMediaPreviewUrl(source);
  if (!url) return null;

  return {
    id: typeof entity.id === "number" ? entity.id : undefined,
    url,
    alternativeText: getString(source.alternativeText),
    name: getString(source.name),
  };
}

function normalizeMediaList(media: unknown) {
  const wrapper = asRecord(media);
  const values = Array.isArray(media)
    ? media
    : Array.isArray(wrapper.data)
      ? wrapper.data
      : [];
  return values.flatMap((item) => {
    const normalized = normalizeMedia(item);
    return normalized ? [normalized] : [];
  });
}

function normalizeSection(section: unknown): StrapiPageSection | null {
  const source = asRecord(section);
  const component = getString(source.__component);
  const imageSide = getString(source.imageSide);
  const galleryColumns = getString(source.galleryColumns);
  const embedAspectRatio = getString(source.embedAspectRatio);
  const formType = getString(source.formType);
  const columnCount = getString(source.columnCount);

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
    images: normalizeMediaList(source.images),
    galleryColumns: galleryColumns === "two" || galleryColumns === "four" ? galleryColumns : "three",
    embedUrl: getString(source.embedUrl),
    embedTitle: getString(source.embedTitle),
    embedAspectRatio: embedAspectRatio === "standard" || embedAspectRatio === "square" ? embedAspectRatio : "landscape",
    formType: formType === "contact" || formType === "newsletter" ? formType : "",
    columnCount: columnCount === "three" ? "three" : "two",
    columnOneHeading: getString(source.columnOneHeading),
    columnOneBody: getString(source.columnOneBody),
    columnTwoHeading: getString(source.columnTwoHeading),
    columnTwoBody: getString(source.columnTwoBody),
    columnThreeHeading: getString(source.columnThreeHeading),
    columnThreeBody: getString(source.columnThreeBody),
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
    heroTitleSize: normalizePageFontSize(source.heroTitleSize),
    heroBodySize: normalizePageFontSize(source.heroBodySize),
    sectionHeadingSize: normalizePageFontSize(source.sectionHeadingSize),
    sectionBodySize: normalizePageFontSize(source.sectionBodySize),
    seoTitle: getString(source.seoTitle),
    seoDescription: getString(source.seoDescription),
    canonicalUrl: getString(source.canonicalUrl),
    noIndex: getBoolean(source.noIndex),
    socialImage: normalizeMedia(source.socialImage),
    scheduledFor: getString(source.scheduledFor),
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

const MANAGED_PAGE_LIST_SIZE = 50;
const MANAGED_PAGE_MAX_SIZE = 100;

type ManagedPageVersionOptions = {
  page?: number;
  pageSize?: number;
  search?: string;
  documentIds?: string[];
  active?: boolean;
  slug?: string;
  excludeDocumentId?: string;
  archived?: "only" | "exclude";
};

function managedPageListUrl(
  baseUrl: string,
  status: StrapiPublicationStatus,
  options: ManagedPageVersionOptions = {},
) {
  const page = Math.max(1, Math.trunc(options.page || 1));
  const pageSize = Math.min(MANAGED_PAGE_MAX_SIZE, Math.max(1, Math.trunc(options.pageSize || MANAGED_PAGE_LIST_SIZE)));
  const url = setStatus(new URL("/api/pages", baseUrl), status);
  url.searchParams.set("pagination[page]", String(page));
  url.searchParams.set("pagination[pageSize]", String(pageSize));
  url.searchParams.set("sort[0]", "navigationOrder:asc");
  url.searchParams.set("sort[1]", "title:asc");

  const search = options.search?.trim().slice(0, 160) || "";
  if (search) {
    for (const [index, field] of ["title", "slug", "pageKey"].entries()) {
      url.searchParams.set(`filters[$or][${index}][${field}][$containsi]`, search);
    }
  }
  options.documentIds?.forEach((documentId, index) => {
    url.searchParams.set(`filters[documentId][$in][${index}]`, documentId);
  });
  if (options.active !== undefined) {
    url.searchParams.set("filters[active][$eq]", String(options.active));
  }
  if (options.slug) {
    url.searchParams.set("filters[slug][$eqi]", options.slug.trim().slice(0, 200));
  }
  if (options.excludeDocumentId) {
    url.searchParams.set("filters[documentId][$ne]", options.excludeDocumentId);
  }
  if (options.archived === "only") {
    url.searchParams.set("filters[archivedAt][$notNull]", "true");
  } else if (options.archived === "exclude") {
    url.searchParams.set("filters[archivedAt][$null]", "true");
  }
  return url;
}

function managedPagePagination(
  payload: StrapiListResponse<ManagedStrapiPage>,
  fallbackPage: number,
  fallbackPageSize: number,
): ManagedStrapiPagePagination {
  const pagination = payload.meta?.pagination;
  const total = Number(pagination?.total);
  const pageSize = Number(pagination?.pageSize) || fallbackPageSize;
  return {
    page: Number(pagination?.page) || fallbackPage,
    pageSize,
    pageCount: Number(pagination?.pageCount) || (Number.isFinite(total) ? Math.ceil(total / pageSize) : 0),
    total: Number.isFinite(total) ? total : payload.data?.length || 0,
  };
}

async function listManagedPageVersion(
  status: StrapiPublicationStatus,
  options: ManagedPageVersionOptions = {},
) {
  const page = Math.max(1, Math.trunc(options.page || 1));
  const pageSize = Math.min(MANAGED_PAGE_MAX_SIZE, Math.max(1, Math.trunc(options.pageSize || MANAGED_PAGE_LIST_SIZE)));
  const payload = await strapiJson<StrapiListResponse<ManagedStrapiPage>>(
    managedPageListUrl(requireConfig(), status, { ...options, page, pageSize }),
  );
  return { payload, pagination: managedPagePagination(payload, page, pageSize) };
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
      heroTitleSize: input.heroTitleSize,
      heroBodySize: input.heroBodySize,
      sectionHeadingSize: input.sectionHeadingSize,
      sectionBodySize: input.sectionBodySize,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      canonicalUrl: input.canonicalUrl || "",
      noIndex: Boolean(input.noIndex),
      socialImage: input.socialImage ?? null,
      scheduledFor: input.scheduledFor || null,
      sections: input.sections,
    },
  };
}

export async function listManagedStrapiPagesPage(
  options: { page?: number; pageSize?: number; search?: string } = {},
): Promise<ManagedStrapiPageResult> {
  const page = Math.max(1, Math.trunc(options.page || 1));
  const pageSize = Math.min(MANAGED_PAGE_MAX_SIZE, Math.max(1, Math.trunc(options.pageSize || MANAGED_PAGE_LIST_SIZE)));
  const search = options.search?.trim().slice(0, 160) || "";
  const draft = await listManagedPageVersion("draft", { page, pageSize, search });
  const documentIds = (draft.payload.data ?? []).map((entity) => getString(entity.documentId)).filter(Boolean);
  const publishedPayload = documentIds.length
    ? (await listManagedPageVersion("published", {
        page: 1,
        pageSize: documentIds.length,
        documentIds,
      })).payload
    : { data: [] };
  const publishedByDocumentId = new Map(
    (publishedPayload.data ?? []).map((entity) => [getString(entity.documentId), entity]),
  );

  const pages = (draft.payload.data ?? []).flatMap((entity) => {
    const page = mergePublicationState(entity, publishedByDocumentId.get(getString(entity.documentId)));
    return page ? [page] : [];
  });
  return { pages, pagination: draft.pagination };
}

export async function listManagedStrapiPages() {
  const pages: ManagedStrapiPage[] = [];
  let page = 1;
  while (true) {
    const result = await listManagedStrapiPagesPage({ page, pageSize: MANAGED_PAGE_MAX_SIZE });
    pages.push(...result.pages);
    if (
      result.pages.length < result.pagination.pageSize ||
      (result.pagination.pageCount > 0 && page >= result.pagination.pageCount)
    ) {
      return pages;
    }
    page += 1;
  }
}

export async function getManagedStrapiPageSummary(): Promise<ManagedStrapiPageSummary> {
  const [all, active, archived, published] = await Promise.all([
    listManagedPageVersion("draft", { page: 1, pageSize: 1 }),
    listManagedPageVersion("draft", { page: 1, pageSize: 1, active: true }),
    listManagedPageVersion("draft", { page: 1, pageSize: 1, archived: "only" }),
    listManagedPageVersion("published", { page: 1, pageSize: 1, archived: "exclude" }),
  ]);
  const total = all.pagination.total;
  const archivedCount = Math.min(total, archived.pagination.total);
  const publishedCount = Math.min(total - archivedCount, published.pagination.total);
  return {
    total,
    active: active.pagination.total,
    archived: archivedCount,
    published: publishedCount,
    draft: Math.max(0, total - archivedCount - publishedCount),
  };
}

export async function assertManagedStrapiPageSlugAvailable(slug: string, excludeDocumentId?: string) {
  const result = await listManagedPageVersion("draft", {
    page: 1,
    pageSize: 1,
    slug,
    excludeDocumentId,
  });
  if ((result.payload.data ?? []).length > 0) {
    throw new Error(`The page URL “${slug}” is already used by another page.`);
  }
}

export async function getManagedStrapiPage(documentId: string) {
  const baseUrl = requireConfig();
  const createUrl = (status: StrapiPublicationStatus) => {
    const url = setStatus(new URL(`/api/pages/${documentId}`, baseUrl), status);
    url.searchParams.set("populate[sections][populate]", "*");
    // A wildcard on Strapi upload files attempts to populate the polymorphic
    // `related` field and is rejected. The media relation itself is sufficient.
    url.searchParams.set("populate[socialImage]", "true");
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
  expectedUpdatedAt: string,
  note = "",
) {
  const payload = await editorialPageRequest(
    `/api/editorial/page/${encodeURIComponent(documentId)}`,
    "PUT",
    { data: pagePayload(input).data, actor: editorialActor(user), expectedUpdatedAt, note },
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
  expectedUpdatedAt: string,
  note = "",
  expectedTitle = "",
) {
  return editorialPageRequest(
    `/api/editorial/page/${encodeURIComponent(documentId)}/${action}`,
    "POST",
    {
      actor: editorialActor(user),
      expectedUpdatedAt,
      note,
      ...(expectedTitle ? { expectedTitle } : {}),
    },
  );
}

export async function rollbackManagedStrapiPage(
  documentId: string,
  revisionDocumentId: string,
  user: CurrentAppUser,
  expectedUpdatedAt: string,
  note = "",
) {
  return editorialPageRequest(
    `/api/editorial/page/${encodeURIComponent(documentId)}/rollback`,
    "POST",
    { actor: editorialActor(user), expectedUpdatedAt, note, revisionDocumentId },
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
