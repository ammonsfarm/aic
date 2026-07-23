import { PastorWoodContentPage, type PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { getPublicFixedCmsPage } from "@/lib/public-fixed-cms-page";
import { publicCmsPageMetadata } from "@/lib/public-seo";

export const dynamic = "force-dynamic";

async function getContactStrapiPage(): Promise<PastorWoodCmsPage | null> {
  return getPublicFixedCmsPage("contact");
}

export async function generateMetadata() {
  return publicCmsPageMetadata({
    page: await getContactStrapiPage(),
    fallbackTitle: "Contact Pastor Wood",
    fallbackDescription: "Contact the Abiding in Christ ministry office or invite Pastor Jim Wood to speak.",
    path: "/contact/",
  });
}

export default async function Page() {
  const strapiPage = await getContactStrapiPage();
  return <PastorWoodContentPage page="contact" cmsPage={strapiPage} />;
}
