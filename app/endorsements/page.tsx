import type { PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { PastorWoodStructuredEndorsementsPage } from "@/components/pastor-wood-structured-listings";
import { publicCmsPageMetadata } from "@/lib/public-seo";
import { getStrapiPageByPageKey } from "@/lib/strapi";

async function getPage(): Promise<PastorWoodCmsPage | null> {
  try {
    const page = await getStrapiPageByPageKey("endorsements");
    return page?.active ? page : null;
  } catch (error) {
    console.error("Strapi lookup failed for endorsements", error);
    return null;
  }
}

export async function generateMetadata() {
  return publicCmsPageMetadata({
    page: await getPage(),
    fallbackTitle: "Endorsements",
    fallbackDescription: "Read endorsements for Pastor Jim Wood and the Abiding in Christ ministry.",
    path: "/endorsements/",
  });
}

export default async function Page() {
  return <PastorWoodStructuredEndorsementsPage cmsPage={await getPage()} />;
}
