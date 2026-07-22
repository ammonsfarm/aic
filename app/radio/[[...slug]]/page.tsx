import type { Metadata } from "next";

import { PastorWoodStructuredRadioPage } from "@/components/pastor-wood-structured-listings";
import { publicCmsPageMetadata, publicMetadata } from "@/lib/public-seo";
import { getStrapiPageByPageKey } from "@/lib/strapi";
import { getPublishedEpisodeBySlug } from "@/lib/strapi-structured-public";

type PageProps = {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<{ page?: string }>;
};

async function getRadioPage() {
  try {
    const page = await getStrapiPageByPageKey("radio");
    return page?.active ? page : null;
  } catch (error) {
    console.error("Strapi lookup failed for radio; using the public fallback.", error);
    return null;
  }
}

function episodeSeo(episode: NonNullable<Awaited<ReturnType<typeof getPublishedEpisodeBySlug>>>) {
  return episode.seo && typeof episode.seo === "object" ? episode.seo as Record<string, unknown> : {};
}

export async function generateMetadata({ params }: Pick<PageProps, "params">): Promise<Metadata> {
  const { slug = [] } = await params;
  const requestedSlug = slug.join("/");
  if (!requestedSlug) {
    return publicCmsPageMetadata({
      page: await getRadioPage(),
      fallbackTitle: "Radio Show Listings",
      fallbackDescription: "Listen to Abiding in Christ radio broadcasts and Bible teaching from Pastor Jim Wood.",
      path: "/radio/",
    });
  }

  const episode = await getPublishedEpisodeBySlug(requestedSlug);
  if (!episode) return { robots: { index: false } };
  const seo = episodeSeo(episode);
  const seoTitle = typeof seo.title === "string" ? seo.title.trim() : "";
  const seoDescription = typeof seo.description === "string" ? seo.description.trim() : "";
  return publicMetadata({
    title: seoTitle || episode.title,
    description: seoDescription || episode.summary || episode.description || "An Abiding in Christ radio broadcast from Pastor Jim Wood.",
    path: `/radio/${episode.slug}/`,
    type: "article",
  });
}

export default async function Page({ params, searchParams }: PageProps) {
  const { slug = [] } = await params;
  const requestedPage = Number((await searchParams).page || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  return <PastorWoodStructuredRadioPage slug={slug} page={page} cmsPage={slug.length ? null : await getRadioPage()} />;
}
