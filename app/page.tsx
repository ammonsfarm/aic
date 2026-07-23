import { PastorWoodSite } from "@/components/pastor-wood-site";
import { getPublicFixedCmsPage } from "@/lib/public-fixed-cms-page";
import { publicCmsPageMetadata } from "@/lib/public-seo";

export const dynamic = "force-dynamic";

async function getHomePage() {
  return getPublicFixedCmsPage("home");
}

export async function generateMetadata() {
  return publicCmsPageMetadata({
    page: await getHomePage(),
    fallbackTitle: "Abiding in Christ with Jim Wood",
    fallbackDescription: "Bible teaching, radio broadcasts, devotionals, and ministry resources from Pastor Jim Wood.",
    path: "/",
    absoluteTitle: true,
  });
}

export default async function Home() {
  return <PastorWoodSite cmsPage={await getHomePage()} />;
}
