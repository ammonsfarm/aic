import { PastorWoodContentPage, type PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { getPublicFixedCmsPage } from "@/lib/public-fixed-cms-page";
import { publicCmsPageMetadata } from "@/lib/public-seo";

export const dynamic = "force-dynamic";

async function getDonatePage(): Promise<PastorWoodCmsPage | null> {
  return getPublicFixedCmsPage("donate");
}

export async function generateMetadata() {
  return publicCmsPageMetadata({
    page: await getDonatePage(),
    fallbackTitle: "Donate",
    fallbackDescription: "Support the Bible teaching and radio ministry of Abiding in Christ.",
    path: "/donate/",
  });
}

export default async function Page() {
  return <PastorWoodContentPage page="donate" cmsPage={await getDonatePage()} />;
}
