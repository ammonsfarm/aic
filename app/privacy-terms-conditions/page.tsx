import { PastorWoodContentPage, type PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { getPublicFixedCmsPage } from "@/lib/public-fixed-cms-page";
import { publicCmsPageMetadata } from "@/lib/public-seo";

export const dynamic = "force-dynamic";

async function getPage(): Promise<PastorWoodCmsPage | null> {
  return getPublicFixedCmsPage("privacy-terms-conditions");
}

export async function generateMetadata() {
  return publicCmsPageMetadata({
    page: await getPage(),
    fallbackTitle: "Privacy, Terms & Conditions",
    fallbackDescription: "Privacy information and website terms for Abiding in Christ with Jim Wood.",
    path: "/privacy-terms-conditions/",
  });
}

export default async function Page() {
  return <PastorWoodContentPage page="privacy" cmsPage={await getPage()} />;
}
