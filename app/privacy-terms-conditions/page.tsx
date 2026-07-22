import { PastorWoodContentPage, type PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { publicCmsPageMetadata } from "@/lib/public-seo";
import { getStrapiPageByPageKey } from "@/lib/strapi";

async function getPage(): Promise<PastorWoodCmsPage | null> {
  try {
    const page = await getStrapiPageByPageKey("privacy-terms-conditions");
    return page?.active ? page : null;
  } catch (error) {
    console.error("Strapi lookup failed for privacy terms", error);
    return null;
  }
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
