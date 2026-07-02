import { PastorWoodContentPage, type PastorWoodCmsPage } from "@/components/pastor-wood-site";
import { getPublishedContentPage } from "@/lib/content-pages";

export const dynamic = "force-dynamic";

async function getAboutCmsPage() {
  try {
    return await getPublishedContentPage("about-pastor-wood");
  } catch (error) {
    console.error("CMS lookup failed for about-pastor-wood", error);
    return null;
  }
}

export default async function Page() {
  const contentPage = await getAboutCmsPage();
  const cmsPage: PastorWoodCmsPage | null = contentPage?.revision
    ? {
        heroTitle: contentPage.revision.heroTitle,
        heroBody: contentPage.revision.heroBody,
      }
    : null;

  return <PastorWoodContentPage page="about" cmsPage={cmsPage} />;
}
