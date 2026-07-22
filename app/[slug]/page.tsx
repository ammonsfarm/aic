import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHero, PastorWoodGenericCmsPage, PastorWoodShell } from "@/components/pastor-wood-site";
import { getStrapiPageBySlugResult } from "@/lib/strapi";
import { publicMetadata } from "@/lib/public-seo";

export const revalidate = 3600;

const unavailableMetadata: Metadata = {
  title: "Page temporarily unavailable",
  description: "This Abiding in Christ page is temporarily unavailable while the public content service reconnects.",
  robots: { index: false, follow: false, noarchive: true },
};

const RESERVED_PUBLIC_SLUGS = new Set([
  "about-pastor-wood",
  "abiding-in-christ",
  "api",
  "archive",
  "bible-study",
  "board-members",
  "compose",
  "contact",
  "content",
  "donate",
  "donor-dashboard",
  "endorsements",
  "episodes",
  "login",
  "overview",
  "pipeline",
  "podcast",
  "privacy",
  "privacy-terms-conditions",
  "radio",
  "reading-plan",
  "research",
  "sermons",
  "signals",
  "sources",
  "stats",
  "writings",
  "written-resources",
]);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug || RESERVED_PUBLIC_SLUGS.has(normalizedSlug)) return { robots: { index: false } };
  const result = await getStrapiPageBySlugResult(normalizedSlug);
  if (result.status === "unavailable") return unavailableMetadata;
  if (result.status === "not-found") return { robots: { index: false } };
  const page = result.page;
  return publicMetadata({
    title: page.seoTitle || page.heroTitle || page.title,
    description: page.seoDescription || page.heroBody || "Abiding in Christ ministry resource.",
    path: `/${normalizedSlug}/`,
  });
}

function DynamicCmsPageUnavailable() {
  return (
    <PastorWoodShell>
      <PageHero
        eyebrow="Content service"
        title="This page is temporarily unavailable."
        body="The public content service could not return this page. Please try again shortly."
      />
      <section className="pw-section pw-content-unavailable" role="status">
        <h2>Continue with Abiding in Christ</h2>
        <p>The home page, radio archive, and writings library remain available from the site navigation.</p>
      </section>
    </PastorWoodShell>
  );
}

export default async function DynamicCmsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const normalizedSlug = slug.trim().toLowerCase();

  if (!normalizedSlug || RESERVED_PUBLIC_SLUGS.has(normalizedSlug)) {
    notFound();
  }

  const result = await getStrapiPageBySlugResult(normalizedSlug);
  if (result.status === "unavailable") {
    return <DynamicCmsPageUnavailable />;
  }
  if (result.status === "not-found") {
    notFound();
  }

  return <PastorWoodGenericCmsPage cmsPage={result.page} />;
}
