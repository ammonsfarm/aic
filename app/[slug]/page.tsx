import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PastorWoodGenericCmsPage } from "@/components/pastor-wood-site";
import { isDynamicCmsPublicSlug } from "@/lib/public-routes";
import { getStrapiPageBySlug } from "@/lib/strapi";
import { publicMetadata } from "@/lib/public-seo";

export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const normalizedSlug = slug.trim().toLowerCase();
  if (!isDynamicCmsPublicSlug(normalizedSlug)) return { robots: { index: false } };
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

  if (!isDynamicCmsPublicSlug(normalizedSlug)) {
    notFound();
  }

  const cmsPage = await getStrapiPageBySlug(normalizedSlug);
  if (!cmsPage?.active) {
    notFound();
  }

  return <PastorWoodGenericCmsPage cmsPage={cmsPage} />;
}
