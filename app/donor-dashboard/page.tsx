import { PastorWoodContentPage, type PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { publicCmsPageMetadata } from "@/lib/public-seo";
import { getStrapiPageByPageKey } from "@/lib/strapi";

async function getDonorDashboardPage(): Promise<PastorWoodCmsPage | null> {
  try {
    const page = await getStrapiPageByPageKey("donor-dashboard");
    return page?.active ? page : null;
  } catch (error) {
    console.error("Strapi lookup failed for donor-dashboard", error);
    return null;
  }
}

export async function generateMetadata() {
  return publicCmsPageMetadata({
    page: await getDonorDashboardPage(),
    fallbackTitle: "Donor Dashboard",
    fallbackDescription: "Access donor account information for Abiding in Christ.",
    path: "/donor-dashboard/",
  });
}

export default async function Page() {
  return <PastorWoodContentPage page="donorDashboard" cmsPage={await getDonorDashboardPage()} />;
}
