import type { PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { PastorWoodStructuredPostsPage } from "@/components/pastor-wood-structured-listings";
import { publicCmsPageMetadata } from "@/lib/public-seo";
import { getStrapiPageByPageKey } from "@/lib/strapi";

async function getDevotionalPage(): Promise<PastorWoodCmsPage | null> {
  try {
    const page = await getStrapiPageByPageKey("bible-study");
    return page?.active ? page : null;
  } catch (error) {
    console.error("Strapi lookup failed for bible-study", error);
    return null;
  }
}

export async function generateMetadata() {
  return publicCmsPageMetadata({
    page: await getDevotionalPage(),
    fallbackTitle: "Weekly Devotional",
    fallbackDescription: "Read weekly devotionals and Bible teaching from Pastor Jim Wood.",
    path: "/bible-study/",
  });
}

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const requestedPage = Number((await searchParams).page || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  return <PastorWoodStructuredPostsPage mode="devotional" cmsPage={await getDevotionalPage()} page={page} />;
}
