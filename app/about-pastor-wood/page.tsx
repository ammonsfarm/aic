import { PastorWoodContentPage, type PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { getPublicFixedCmsPage } from "@/lib/public-fixed-cms-page";
import { publicCmsPageMetadata } from "@/lib/public-seo";

export const dynamic = "force-dynamic";

async function getAboutStrapiPage(): Promise<PastorWoodCmsPage | null> {
  return getPublicFixedCmsPage("about");
}

export async function generateMetadata() {
  return publicCmsPageMetadata({
    page: await getAboutStrapiPage(),
    fallbackTitle: "About Pastor Jim Wood",
    fallbackDescription: "Learn about Pastor Jim Wood, founder of Wears Valley Ranch and host of Abiding in Christ.",
    path: "/about-pastor-wood/",
  });
}

export default async function Page() {
  const strapiPage = await getAboutStrapiPage();
  return <PastorWoodContentPage page="about" cmsPage={strapiPage} />;
}
