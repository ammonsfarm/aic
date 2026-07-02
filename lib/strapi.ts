import "server-only";

export type StrapiPageSection = {
  id?: number;
  component: string;
  eyebrow: string;
  heading: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string;
  imageSide: "none" | "left" | "right" | "";
};

export type StrapiPage = {
  pageKey: string;
  slug: string;
  title: string;
  heroTitle: string;
  heroBody: string;
  seoTitle: string;
  seoDescription: string;
  sections: StrapiPageSection[];
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

function normalizePageSection(section: unknown): StrapiPageSection | null {
  if (!section || typeof section !== "object") {
    return null;
  }

  const source = section as Record<string, unknown>;
  const imageSide = getString(source.imageSide);

  return {
    id: typeof source.id === "number" ? source.id : undefined,
    component: getString(source.__component),
    eyebrow: getString(source.eyebrow),
    heading: getString(source.heading),
    body: getString(source.body),
    buttonLabel: getString(source.buttonLabel),
    buttonUrl: getString(source.buttonUrl),
    imageSide: imageSide === "none" || imageSide === "left" || imageSide === "right" ? imageSide : "",
  };
}

function normalizePage(entity: StrapiEntity<StrapiPage>): StrapiPage | null {
  const source = entity.attributes ?? entity;
  const pageKey = getString(source.pageKey);
  const slug = getString(source.slug);
  const title = getString(source.title);

  if (!pageKey && !slug && !title) {
    return null;
  }

  const rawSections = Array.isArray(source.sections) ? source.sections : [];

  return {
    pageKey,
    slug,
    title,
    heroTitle: getString(source.heroTitle),
    heroBody: getString(source.heroBody),
    seoTitle: getString(source.seoTitle),
    seoDescription: getString(source.seoDescription),
    sections: rawSections.flatMap((section) => {
      const normalized = normalizePageSection(section);
      return normalized ? [normalized] : [];
    }),
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
    const details = await response.text().catch(() => "");
    console.warn(`Strapi page request failed with ${response.status}. Falling back.`, details.slice(0, 500));
    return null;
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
  url.searchParams.set("status", "published");
  url.searchParams.set("pagination[pageSize]", "1");
  url.searchParams.set("populate[sections][populate]", "*");

  return fetchStrapiPages(url);
}

export async function getStrapiPageBySlug(slug: string): Promise<StrapiPage | null> {
  const baseUrl = strapiBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const url = new URL("/api/pages", baseUrl);
  url.searchParams.set("filters[slug][$eq]", slug);
  url.searchParams.set("status", "published");
  url.searchParams.set("pagination[pageSize]", "1");
  url.searchParams.set("populate[sections][populate]", "*");

  return fetchStrapiPages(url);
}
