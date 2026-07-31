import Link from "next/link";
import { notFound } from "next/navigation";

import { PastorWoodGenericCmsPage } from "@/components/pastor-wood-site";
import { getManagedStrapiPage } from "@/lib/strapi-management";
import { requireContentManagerOrAdmin } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function SitePageDraftPreview({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  await requireContentManagerOrAdmin();
  const { documentId } = await params;
  let page: Awaited<ReturnType<typeof getManagedStrapiPage>>;
  try {
    page = await getManagedStrapiPage(documentId);
  } catch (error) {
    console.error("Draft preview lookup failed", error);
    return (
      <main className="stack">
        <section className="notice-card notice-card--error" role="alert">
          <strong>Draft preview unavailable</strong>
          <p>Strapi could not be reached. No public content was changed.</p>
          <Link className="button button--ghost" href={`/content/site-pages/${documentId}`}>Back to editor</Link>
        </section>
      </main>
    );
  }

  if (!page) {
    notFound();
  }

  return (
    <>
      <aside className="notice-card" role="status">
        <strong>Draft preview</strong>
        <p>This protected preview is not the published page.</p>
      </aside>
      <PastorWoodGenericCmsPage
        cmsPage={{
          title: page.title,
          heroLabel: page.heroLabel,
          heroTitle: page.heroTitle,
          heroBody: page.heroBody,
          heroTitleSize: page.heroTitleSize,
          heroBodySize: page.heroBodySize,
          sectionHeadingSize: page.sectionHeadingSize,
          sectionBodySize: page.sectionBodySize,
          sections: page.sections,
        }}
      />
    </>
  );
}
