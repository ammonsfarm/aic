export const RESERVED_PAGE_SLUGS = new Set([
  "about-pastor-wood",
  "abiding-in-christ",
  "admin",
  "api",
  "app",
  "archive",
  "bible-study",
  "board-members",
  "compose",
  "contact",
  "content",
  "donate",
  "donor-dashboard",
  "endorsements",
  "episodes",
  "feed",
  "login",
  "media",
  "overview",
  "pipeline",
  "podcast",
  "privacy",
  "privacy-terms-conditions",
  "preview",
  "radio",
  "reading-plan",
  "research",
  "robots.txt",
  "sermons",
  "signals",
  "sitemap.xml",
  "sources",
  "stats",
  "unsubscribe",
  "writings",
  "written-resources",
  "wp-content",
]);

export function slugifyPageIdentifier(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function assertAllowedPageSlug({
  slug,
  originalSlug,
}: {
  slug: string;
  originalSlug?: string;
}) {
  const normalizedSlug = slugifyPageIdentifier(slug);
  const normalizedOriginal = slugifyPageIdentifier(originalSlug ?? "");

  if (!normalizedSlug) {
    throw new Error("Page URL is required.");
  }

  if (RESERVED_PAGE_SLUGS.has(normalizedSlug) && normalizedSlug !== normalizedOriginal) {
    throw new Error(`The page URL “${normalizedSlug}” is reserved by the application.`);
  }

  return normalizedSlug;
}

export function assertUniquePageSlug({
  slug,
  pages,
  excludeDocumentId,
}: {
  slug: string;
  pages: Array<{ slug: string; documentId: string }>;
  excludeDocumentId?: string;
}) {
  const duplicate = pages.find(
    (page) =>
      page.documentId !== excludeDocumentId &&
      slugifyPageIdentifier(page.slug) === slugifyPageIdentifier(slug),
  );

  if (duplicate) {
    throw new Error(`The page URL “${slug}” is already used by another page.`);
  }
}

export function immutablePageKey({
  existingPageKey,
  requestedPageKey,
  slug,
}: {
  existingPageKey?: string;
  requestedPageKey?: string;
  slug: string;
}) {
  const existing = slugifyPageIdentifier(existingPageKey ?? "");
  if (existing) {
    return existing;
  }

  return slugifyPageIdentifier(requestedPageKey || slug);
}
