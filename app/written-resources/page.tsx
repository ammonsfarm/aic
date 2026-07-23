import type { PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { PastorWoodStructuredPostsPage } from "@/components/pastor-wood-structured-listings";
import { getPublicFixedCmsPage } from "@/lib/public-fixed-cms-page";
import { publicArchiveCanonicalPath, publicArchivePage } from "@/lib/public-pagination";
import { publicCmsPageMetadata } from "@/lib/public-seo";

type PageProps = { searchParams: Promise<{ page?: string }> };

async function getPage(): Promise<PastorWoodCmsPage | null> {
  return getPublicFixedCmsPage("written-resources");
}

export async function generateMetadata({ searchParams }: PageProps) {
  const page = publicArchivePage((await searchParams).page);
  return publicCmsPageMetadata({
    page: await getPage(),
    fallbackTitle: "Written Resources",
    fallbackDescription: "Read written resources from Pastor Jim Wood and Abiding in Christ.",
    path: publicArchiveCanonicalPath("/written-resources/", page),
  });
}

export default async function Page({ searchParams }: PageProps) {
  const page = publicArchivePage((await searchParams).page);
  return <PastorWoodStructuredPostsPage mode="written" cmsPage={await getPage()} page={page} />;
}
