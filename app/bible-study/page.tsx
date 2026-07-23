import type { PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { PastorWoodStructuredPostsPage } from "@/components/pastor-wood-structured-listings";
import { getPublicFixedCmsPage } from "@/lib/public-fixed-cms-page";
import { publicArchiveCanonicalPath, publicArchivePage } from "@/lib/public-pagination";
import { publicCmsPageMetadata } from "@/lib/public-seo";

type PageProps = { searchParams: Promise<{ page?: string }> };

async function getDevotionalPage(): Promise<PastorWoodCmsPage | null> {
  return getPublicFixedCmsPage("bible-study");
}

export async function generateMetadata({ searchParams }: PageProps) {
  const page = publicArchivePage((await searchParams).page);
  return publicCmsPageMetadata({
    page: await getDevotionalPage(),
    fallbackTitle: "Weekly Devotional",
    fallbackDescription: "Read weekly devotionals and Bible teaching from Pastor Jim Wood.",
    path: publicArchiveCanonicalPath("/bible-study/", page),
  });
}

export default async function Page({ searchParams }: PageProps) {
  const page = publicArchivePage((await searchParams).page);
  return <PastorWoodStructuredPostsPage mode="devotional" cmsPage={await getDevotionalPage()} page={page} />;
}
