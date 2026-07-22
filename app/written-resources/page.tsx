import type { PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { PastorWoodStructuredPostsPage } from "@/components/pastor-wood-structured-listings";
import { publicCmsPageMetadata } from "@/lib/public-seo";
import { getStrapiPageByPageKey } from "@/lib/strapi";

async function getPage(): Promise<PastorWoodCmsPage | null> {
  try {
    const page = await getStrapiPageByPageKey("written-resources");
    return page?.active ? page : null;
  } catch (error) {
    console.error("Strapi lookup failed for written resources", error);
    return null;
  }
}

export async function generateMetadata() {
  return publicCmsPageMetadata({
    page: await getPage(),
    fallbackTitle: "Written Resources",
    fallbackDescription: "Read written resources from Pastor Jim Wood and Abiding in Christ.",
    path: "/written-resources/",
  });
}

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const requestedPage = Number((await searchParams).page || 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  return <PastorWoodStructuredPostsPage mode="written" cmsPage={await getPage()} page={page} />;
}
