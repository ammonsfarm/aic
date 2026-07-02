import "server-only";

export type StrapiPage = {
  pageKey: string;
  slug: string;
  title: string;
  heroTitle: string;
  heroBody: string;
  seoTitle: string;
  seoDescription: string;
};

type StrapiEntity<T> = {
  id?: number;
  documentId?: string;
  attributes?: Partial<T>;
} & Partial<T>;

type StrapiListResponse<T> = {
  data?: Array<StrapiEntity<T>>;
};

function strapiBaseUrl() {
  return process.env.STRAPI_URL?.replace(/\/+$/, "") || "";
}

function strapiApiToken() {
  return process.env.STRAPI_API_TOKEN?.trim() || "";
}

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizePage(entity: StrapiEntity<StrapiPage>): StrapiPage | null {
  const source = entity.attributes ?? entity;
  const pageKey = getString(source.pageKey);
  const slug = getString(source.slug);
  const title = getString(source.title);

  if (!pageKey && !slug && !title) {
    return null;
  }

  return {
    pageKey,
    slug,
    title,
    heroTitle: getString(source.heroTitle),
    heroBody: getString(source.heroBody),
    seoTitle: getString(source.seoTitle),
    seoDescription: getString(source.seoDescription),
  };
}

async function fetchStrapiPages(url: URL): Promise<StrapiPage | null> {
  const token = strapiApiToken();
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

  const response = await fetch(url, {
    headers,
    next: { revalidate: 30 },
  });

  if (!response.ok) {
    throw new Error(`Strapi request failed with ${response.status}`);
  }

  const payload = (await response.json()) as StrapiListResponse<StrapiPage>;
  const entity = payload.data?.[0];
  return entity ? normalizePage(entity) : null;
}

export async function getStrapiPageByPageKey(pageKey: string): Promise<StrapiPage | null> {
  const baseUrl = strapiBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const url = new URL("/api/pages", baseUrl);
  url.searchParams.set("filters[pageKey][$eq]", pageKey);
  url.searchParams.set("publicationState", "live");
  url.searchParams.set("pagination[pageSize]", "1");

  return fetchStrapiPages(url);
}

export async function getStrapiPageBySlug(slug: string): Promise<StrapiPage | null> {
  const baseUrl = strapiBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const url = new URL("/api/pages", baseUrl);
  url.searchParams.set("filters[slug][$eq]", slug);
  url.searchParams.set("publicationState", "live");
  url.searchParams.set("pagination[pageSize]", "1");

  return fetchStrapiPages(url);
}
