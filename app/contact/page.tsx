import { PastorWoodContentPage, type PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { getPublishedContentPage } from "@/lib/content-pages";

export const dynamic = "force-dynamic";

async function getContactCmsPage() {
  try {
    return await getPublishedContentPage("contact");
  } catch (error) {
    console.error("CMS lookup failed for contact", error);
    return null;
  }
}

export default async function Page() {
  const contentPage = await getContactCmsPage();
  const cmsPage: PastorWoodCmsPage | null = contentPage?.revision
    ? {
        heroTitle: contentPage.revision.heroTitle,
        heroBody: contentPage.revision.heroBody,
      }
    : null;

  return <PastorWoodContentPage page="contact" cmsPage={cmsPage} />;
}
