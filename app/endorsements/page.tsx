import type { PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { PastorWoodStructuredEndorsementsPage } from "@/components/pastor-wood-structured-listings";
import { getPublicFixedCmsPage } from "@/lib/public-fixed-cms-page";
import { publicCmsPageMetadata } from "@/lib/public-seo";

export const dynamic = "force-dynamic";

async function getPage(): Promise<PastorWoodCmsPage | null> {
  return getPublicFixedCmsPage("endorsements");
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
