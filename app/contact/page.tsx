import { PastorWoodContentPage, type PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { getPublishedContentPage } from "@/lib/content-pages";
import { publicCmsPageMetadata } from "@/lib/public-seo";
import { getStrapiPageByPageKey } from "@/lib/strapi";

async function getContactStrapiPage(): Promise<PastorWoodCmsPage | null> {
  try {
    const page = await getStrapiPageByPageKey("contact");
    return page?.active ? page : null;
  } catch (error) {
    console.error("Strapi lookup failed for contact", error);
    return null;
  }
}

export async function generateMetadata() {
  return publicCmsPageMetadata({
    page: await getContactStrapiPage(),
    fallbackTitle: "Contact Pastor Wood",
    fallbackDescription: "Contact the Abiding in Christ ministry office or invite Pastor Jim Wood to speak.",
    path: "/contact/",
  });
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
