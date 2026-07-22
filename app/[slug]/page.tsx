import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PastorWoodGenericCmsPage } from "@/components/pastor-wood-site";
import { getStrapiPageBySlug } from "@/lib/strapi";
import { publicMetadata } from "@/lib/public-seo";

export const revalidate = 3600;

const RESERVED_PUBLIC_SLUGS = new Set([
  "about-pastor-wood",
  "api",
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
  "login",
  "overview",
  "pipeline",
  "podcast",
  "privacy",
  "privacy-terms-conditions",
  "radio",
  "reading-plan",
  "research",
  "sermons",
  "signals",
  "sources",
  "stats",
  "writings",
  "written-resources",
]);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug || RESERVED_PUBLIC_SLUGS.has(normalizedSlug)) return { robots: { index: false } };
  const page = await getStrapiPageBySlug(normalizedSlug);
  if (!page?.active) return { robots: { index: false } };
  return publicMetadata({
    title: page.seoTitle || page.heroTitle || page.title,
    description: page.seoDescription || page.heroBody || "Abiding in Christ ministry resource.",
    path: `/${normalizedSlug}/`,
  });
}

export default async function DynamicCmsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const normalizedSlug = slug.trim().toLowerCase();

  if (!normalizedSlug || RESERVED_PUBLIC_SLUGS.has(normalizedSlug)) {
    notFound();
  }

  const cmsPage = await getStrapiPageBySlug(normalizedSlug);
  if (!cmsPage?.active) {
    notFound();
  }

  return <PastorWoodGenericCmsPage cmsPage={cmsPage} />;
}
