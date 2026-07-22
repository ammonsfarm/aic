import { PastorWoodContentPage, type PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { getPublishedContentPage } from "@/lib/content-pages";
import { publicCmsPageMetadata } from "@/lib/public-seo";
import { getStrapiPageByPageKey } from "@/lib/strapi";

async function getAboutStrapiPage(): Promise<PastorWoodCmsPage | null> {
  try {
    const page = await getStrapiPageByPageKey("about");
    return page?.active ? page : null;
  } catch (error) {
    console.error("Strapi lookup failed for about", error);
    return null;
  }
}

export async function generateMetadata() {
  return publicCmsPageMetadata({
    page: await getAboutStrapiPage(),
    fallbackTitle: "About Pastor Jim Wood",
    fallbackDescription: "Learn about Pastor Jim Wood, founder of Wears Valley Ranch and host of Abiding in Christ.",
    path: "/about-pastor-wood/",
  });
}

async function getAboutCmsPage() {
  try {
    return await getPublishedContentPage("about-pastor-wood");
  } catch (error) {
    console.error("CMS lookup failed for about-pastor-wood", error);
    return null;
  }
}

export default async function Page() {
  const strapiPage = await getAboutStrapiPage();
  if (strapiPage) {
    return <PastorWoodContentPage page="about" cmsPage={strapiPage} />;
  }

  const contentPage = await getAboutCmsPage();
  const cmsPage: PastorWoodCmsPage | null = contentPage?.revision
    ? {
        heroTitle: contentPage.revision.heroTitle,
        heroBody: contentPage.revision.heroBody,
      }
    : null;

  return <PastorWoodContentPage page="about" cmsPage={cmsPage} />;
}
