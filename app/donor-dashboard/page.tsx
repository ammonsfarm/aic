import { PastorWoodContentPage, type PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { getStrapiPageByPageKey } from "@/lib/strapi";

async function getDonorDashboardPage(): Promise<PastorWoodCmsPage | null> {
  try {
    const page = await getStrapiPageByPageKey("donor-dashboard");
    return page ? { heroTitle: page.heroTitle, heroBody: page.heroBody, sections: page.sections } : null;
  } catch (error) {
    console.error("Strapi lookup failed for donor-dashboard", error);
    return null;
  }
}

export default async function Page() {
  return <PastorWoodContentPage page="donorDashboard" cmsPage={await getDonorDashboardPage()} />;
}
