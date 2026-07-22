import { PastorWoodContentPage, type PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { publicCmsPageMetadata } from "@/lib/public-seo";
import { getStrapiPageByPageKey } from "@/lib/strapi";

async function getDonatePage(): Promise<PastorWoodCmsPage | null> {
  try {
    const page = await getStrapiPageByPageKey("donate");
    return page?.active ? page : null;
  } catch (error) {
    console.error("Strapi lookup failed for donate", error);
    return null;
  }
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
