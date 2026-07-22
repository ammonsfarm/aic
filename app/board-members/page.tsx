import type { PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { PastorWoodStructuredBoardPage } from "@/components/pastor-wood-structured-listings";
import { publicCmsPageMetadata } from "@/lib/public-seo";
import { getStrapiPageByPageKey } from "@/lib/strapi";

async function getPage(): Promise<PastorWoodCmsPage | null> {
  try {
    const page = await getStrapiPageByPageKey("board-members");
    return page?.active ? page : null;
  } catch (error) {
    console.error("Strapi lookup failed for board-members", error);
    return null;
  }
}

export async function generateMetadata() {
  return publicCmsPageMetadata({
    page: await getPage(),
    fallbackTitle: "Board Members",
    fallbackDescription: "Meet the board members serving the Abiding in Christ ministry.",
    path: "/board-members/",
  });
}

export default async function Page() {
  return <PastorWoodStructuredBoardPage cmsPage={await getPage()} />;
}
