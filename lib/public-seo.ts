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
}: {
  title: string;
  description: string;
  path: string;
  type?: "website" | "article";
}): Metadata {
  const canonical = canonicalPublicUrl(path);
  return {
    title,
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

export { DEFAULT_PUBLIC_ORIGIN };
