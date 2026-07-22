import type { PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { PastorWoodStructuredBoardPage } from "@/components/pastor-wood-structured-listings";
import { getStrapiPageByPageKey } from "@/lib/strapi";

async function getPage(): Promise<PastorWoodCmsPage | null> {
  try {
    const page = await getStrapiPageByPageKey("board-members");
    return page ? { heroTitle: page.heroTitle, heroBody: page.heroBody, sections: page.sections } : null;
  } catch (error) {
    console.error("Strapi lookup failed for board-members", error);
    return null;
  }
}

export default async function Page() {
  return <PastorWoodStructuredBoardPage cmsPage={await getPage()} />;
}
