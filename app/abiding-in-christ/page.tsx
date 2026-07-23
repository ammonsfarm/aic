import { PastorWoodContentPage } from "@/components/pastor-wood-site";
import { getPublicFixedCmsPage } from "@/lib/public-fixed-cms-page";
import { publicCmsPageMetadata } from "@/lib/public-seo";

export const dynamic = "force-dynamic";

async function getPage() {
  return getPublicFixedCmsPage("abiding-in-christ");
}

export async function generateMetadata() {
  return publicCmsPageMetadata({
    page: await getPage(),
    fallbackTitle: "Abiding in Christ Radio Ministry",
    fallbackDescription: "Bible teaching, interviews, and radio programs from Abiding in Christ with Jim Wood.",
    path: "/abiding-in-christ/",
  });
}

export default async function Page() {
  return <PastorWoodContentPage page="abiding" cmsPage={await getPage()} />;
}
