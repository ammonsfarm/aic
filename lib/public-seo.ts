import type { Metadata } from "next";

import { safeCmsHref, safeCmsImageSrc } from "@/lib/cms-html";

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
  canonicalUrl,
  noIndex = false,
  imageUrl,
}: {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
  absoluteTitle?: boolean;
  canonicalUrl?: string | null;
  noIndex?: boolean;
  imageUrl?: string | null;
}): Metadata {
  const safeCanonical = safeCmsHref(canonicalUrl || "");
  const canonical = safeCanonical && !safeCanonical.startsWith("#") && !safeCanonical.startsWith("mailto:") && !safeCanonical.startsWith("tel:")
    ? (safeCanonical.startsWith("/") ? canonicalPublicUrl(safeCanonical) : safeCanonical)
    : canonicalPublicUrl(path);
  const safeImage = safeCmsImageSrc(imageUrl || "");
  const socialImage = safeImage
    ? canonicalPublicUrl(safeImage)
    : canonicalPublicUrl("/images/pastorwood/smoky-mountain-church.png");
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
      images: [{ url: socialImage, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
    ...(noIndex ? { robots: { index: false, follow: false } } : {}),
  };
}

type PublicCmsSeoPage = {
  title?: string;
  heroTitle?: string;
  heroBody?: string;
  seoTitle?: string;
  seoDescription?: string;
  canonicalUrl?: string;
  noIndex?: boolean;
  socialImage?: { url?: string } | null;
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
  return publicMetadata({
    title,
    description,
    path,
    absoluteTitle,
    canonicalUrl: page?.canonicalUrl,
    noIndex: page?.noIndex,
    imageUrl: page?.socialImage?.url,
  });
}

export { DEFAULT_PUBLIC_ORIGIN };
