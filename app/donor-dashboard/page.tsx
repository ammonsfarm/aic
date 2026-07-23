import { PastorWoodContentPage, type PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { getPublicFixedCmsPage } from "@/lib/public-fixed-cms-page";
import { publicCmsPageMetadata } from "@/lib/public-seo";

export const dynamic = "force-dynamic";

async function getDonorDashboardPage(): Promise<PastorWoodCmsPage | null> {
  return getPublicFixedCmsPage("donor-dashboard");
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
