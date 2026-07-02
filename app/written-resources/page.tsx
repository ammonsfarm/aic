import { PastorWoodContentPage, type PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { getStrapiPageByPageKey } from "@/lib/strapi";

export const dynamic = "force-dynamic";

async function getPage(): Promise<PastorWoodCmsPage | null> {
  try {
    const page = await getStrapiPageByPageKey("written-resources");
    return page ? { heroTitle: page.heroTitle, heroBody: page.heroBody, sections: page.sections } : null;
  } catch (error) {
    console.error("Strapi lookup failed for written resources", error);
    return null;
  }
}

export default async function Page() {
  return <PastorWoodContentPage page="written" cmsPage={await getPage()} />;
}
