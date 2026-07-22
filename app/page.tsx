import { PastorWoodSite } from "@/components/pastor-wood-site";
import { publicCmsPageMetadata } from "@/lib/public-seo";
import { getStrapiPageByPageKey } from "@/lib/strapi";

async function getHomePage() {
  try {
    const page = await getStrapiPageByPageKey("home");
    return page?.active ? page : null;
  } catch (error) {
    console.error("Strapi lookup failed for home; using the static public fallback.", error);
    return null;
  }
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
