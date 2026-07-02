import { PastorWoodContentPage, type PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { getPublishedContentPage } from "@/lib/content-pages";
import { getStrapiPageByPageKey } from "@/lib/strapi";

export const dynamic = "force-dynamic";

async function getContactStrapiPage(): Promise<PastorWoodCmsPage | null> {
  try {
    const page = await getStrapiPageByPageKey("contact");
    return page
      ? {
          heroTitle: page.heroTitle,
          heroBody: page.heroBody,
          sections: page.sections,
        }
      : null;
  } catch (error) {
    console.error("Strapi lookup failed for contact", error);
    return null;
  }
}

async function getContactCmsPage() {
  try {
    return await getPublishedContentPage("contact");
  } catch (error) {
    console.error("CMS lookup failed for contact", error);
    return null;
  }
}

export default async function Page() {
  const strapiPage = await getContactStrapiPage();
  if (strapiPage) {
    return <PastorWoodContentPage page="contact" cmsPage={strapiPage} />;
  }

  const contentPage = await getContactCmsPage();
  const cmsPage: PastorWoodCmsPage | null = contentPage?.revision
    ? {
        heroTitle: contentPage.revision.heroTitle,
        heroBody: contentPage.revision.heroBody,
      }
    : null;

  return <PastorWoodContentPage page="contact" cmsPage={cmsPage} />;
}
