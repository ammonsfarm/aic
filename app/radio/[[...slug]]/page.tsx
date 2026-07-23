import type { Metadata } from "next";

import { PastorWoodStructuredRadioPage } from "@/components/pastor-wood-structured-listings";
import { publicArchiveCanonicalPath, publicArchivePage } from "@/lib/public-pagination";
import { getPublicFixedCmsPage } from "@/lib/public-fixed-cms-page";
import { parsePublicRadioArchiveState, publicRadioArchivePath } from "@/lib/public-radio-search";
import { publicCmsPageMetadata, publicMetadata } from "@/lib/public-seo";
import { getPublishedEpisodeBySlugResult } from "@/lib/strapi-structured-public";

type PageProps = {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<{ page?: string | string[]; q?: string | string[]; year?: string | string[] }>;
};

async function getRadioPage() {
  return getPublicFixedCmsPage("radio");
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { slug = [] } = await params;
  const requestedSlug = slug.join("/");
  if (!requestedSlug) {
    const archive = parsePublicRadioArchiveState(await searchParams);
    const path = archive.hasFilters
      ? publicRadioArchivePath(archive)
      : publicArchiveCanonicalPath("/radio/", publicArchivePage(String(archive.page)));
    const metadata = publicCmsPageMetadata({
      page: await getRadioPage(),
      fallbackTitle: "Radio Show Listings",
      fallbackDescription: "Listen to Abiding in Christ radio broadcasts and Bible teaching from Pastor Jim Wood.",
      path,
    });
    return archive.hasFilters ? { ...metadata, robots: { index: false, follow: true } } : metadata;
  }

  const result = await getPublishedEpisodeBySlugResult(requestedSlug);
  if (result.status === "unavailable") {
    return {
      title: "Radio episode temporarily unavailable",
      description: "This Abiding in Christ broadcast is temporarily unavailable while the public content service reconnects.",
      robots: { index: false, follow: true, noarchive: true },
    };
  }
  if (result.status === "not-found") return { robots: { index: false } };
  const episode = result.item;
  const seo = episode.seo || { title: "", description: "", canonicalUrl: "", noIndex: false, socialImageUrl: "" };
  return publicMetadata({
    title: seo.title || episode.title,
    description: seo.description || episode.summary || episode.description || "An Abiding in Christ radio broadcast from Pastor Jim Wood.",
    path: `/radio/${episode.slug}/`,
    type: "article",
    canonicalUrl: seo.canonicalUrl,
    noIndex: seo.noIndex,
    imageUrl: seo.socialImageUrl || episode.featuredImageUrl,
  });
}

export default async function Page({ params, searchParams }: PageProps) {
  const { slug = [] } = await params;
  const archive = parsePublicRadioArchiveState(await searchParams);
  return <PastorWoodStructuredRadioPage slug={slug} archive={archive} cmsPage={slug.length ? null : await getRadioPage()} />;
}
