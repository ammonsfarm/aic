import type { PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { PastorWoodStructuredBoardPage } from "@/components/pastor-wood-structured-listings";
import { getPublicFixedCmsPage } from "@/lib/public-fixed-cms-page";
import { publicCmsPageMetadata } from "@/lib/public-seo";

export const dynamic = "force-dynamic";

async function getPage(): Promise<PastorWoodCmsPage | null> {
  return getPublicFixedCmsPage("board-members");
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
