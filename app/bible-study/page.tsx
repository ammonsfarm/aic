import type { PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { PastorWoodStructuredPostsPage } from "@/components/pastor-wood-structured-listings";
import { publicArchiveCanonicalPath, publicArchivePage } from "@/lib/public-pagination";
import { publicCmsPageMetadata } from "@/lib/public-seo";
import { getStrapiPageByPageKey } from "@/lib/strapi";

type PageProps = { searchParams: Promise<{ page?: string }> };

async function getDevotionalPage(): Promise<PastorWoodCmsPage | null> {
  try {
    const page = await getStrapiPageByPageKey("bible-study");
    return page?.active ? page : null;
  } catch (error) {
    console.error("Strapi lookup failed for bible-study", error);
    return null;
  }
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
