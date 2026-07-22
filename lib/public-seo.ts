import type { Metadata } from "next";

const DEFAULT_PUBLIC_ORIGIN = "https://www.pastorwood.org";

export function publicSiteOrigin() {
  const candidate = process.env.PASTORWOOD_PUBLIC_URL?.trim() || DEFAULT_PUBLIC_ORIGIN;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.origin : DEFAULT_PUBLIC_ORIGIN;
  } catch {
    return DEFAULT_PUBLIC_ORIGIN;
  }
}

export function isPublicIndexingEnabled() {
  return process.env.PASTORWOOD_ALLOW_INDEXING === "true" && publicSiteOrigin() === DEFAULT_PUBLIC_ORIGIN;
}

export function canonicalPublicUrl(pathname: string) {
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return new URL(path, `${publicSiteOrigin()}/`).toString();
}

export function publicMetadata({
  title,
  description,
  path,
  type = "website",
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
  absoluteTitle?: boolean;
}): Metadata {
  const canonical = canonicalPublicUrl(path);
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical },
    openGraph: {
      type,
      title,
      description,
      url: canonical,
      siteName: "Abiding in Christ with Jim Wood",
      images: [{ url: canonicalPublicUrl("/images/pastorwood/smoky-mountain-church.png"), alt: "Abiding in Christ" }],
    },
  };
}

type PublicCmsSeoPage = {
  title?: string;
  heroTitle?: string;
  heroBody?: string;
  seoTitle?: string;
  seoDescription?: string;
} | null | undefined;

function metadataText(value: string | undefined) {
  return (value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function publicCmsPageMetadata({
  page,
  fallbackTitle,
  fallbackDescription,
  path,
  absoluteTitle = false,
}: {
  page?: PublicCmsSeoPage;
  fallbackTitle: string;
  fallbackDescription: string;
  path: string;
  absoluteTitle?: boolean;
}) {
  const title = metadataText(page?.seoTitle) || metadataText(page?.heroTitle) || metadataText(page?.title) || fallbackTitle;
  const description = metadataText(page?.seoDescription) || metadataText(page?.heroBody) || fallbackDescription;
  return publicMetadata({ title, description, path, absoluteTitle });
}

export { DEFAULT_PUBLIC_ORIGIN };
