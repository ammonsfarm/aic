import { PastorWoodContentPage, type PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { getPublishedContentPage } from "@/lib/content-pages";
import { getStrapiPageByPageKey } from "@/lib/strapi";

async function getAboutStrapiPage(): Promise<PastorWoodCmsPage | null> {
  try {
    const page = await getStrapiPageByPageKey("about");
    return page
      ? {
          heroTitle: page.heroTitle,
          heroBody: page.heroBody,
          sections: page.sections,
        }
      : null;
  } catch (error) {
    console.error("Strapi lookup failed for about", error);
    return null;
  }
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
