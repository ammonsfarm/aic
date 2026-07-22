import { PastorWoodContentPage } from "@/components/pastor-wood-site";
import { publicCmsPageMetadata } from "@/lib/public-seo";
import { getStrapiPageByPageKey } from "@/lib/strapi";

async function getPage() {
  try {
    const page = await getStrapiPageByPageKey("abiding-in-christ");
    return page?.active ? page : null;
  } catch (error) {
    console.error("Strapi lookup failed for abiding-in-christ; using the public fallback.", error);
    return null;
  }
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
