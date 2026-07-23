import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHero, PastorWoodShell } from "@/components/pastor-wood-site";
import { sanitizeCmsHtml } from "@/lib/cms-html";
import { publicMetadata } from "@/lib/public-seo";
import { getPublishedPostBySlugResult } from "@/lib/strapi-structured-public";

export const revalidate = 300;

function formatDate(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublishedPostBySlugResult(decodeURIComponent(slug));
  if (result.status === "unavailable") {
    return {
      title: "Writing temporarily unavailable",
      description: "This Pastor Wood writing is temporarily unavailable while the public content service reconnects.",
      robots: { index: false, follow: true, noarchive: true },
    };
  }
  if (result.status === "not-found") return { robots: { index: false } };
  const post = result.item;
  return publicMetadata({
    title: post.title,
    description: post.summary || "A writing from Pastor Jim Wood.",
    path: `/writings/${post.slug}/`,
    type: "article",
  });
}

export default async function WritingDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getPublishedPostBySlugResult(decodeURIComponent(slug));
  if (result.status === "not-found") notFound();

  if (result.status === "unavailable") {
    return (
      <PastorWoodShell>
        <PageHero
          eyebrow="Written Resources"
          title="This writing is temporarily unavailable"
          body="The public content service could not return this writing."
        />
        <section className="pw-section pw-content-unavailable" role="alert">
          <h2>Please try again shortly</h2>
          <p>This is a temporary content-service problem, not a missing page.</p>
          <div className="pw-inline-links">
            <Link href={`/writings/${encodeURIComponent(slug)}/`}>Retry this writing</Link>
            <Link href="/written-resources/">Browse other writings</Link>
          </div>
        </section>
      </PastorWoodShell>
    );
  }

  const post = result.item;

  return (
    <PastorWoodShell>
      <PageHero eyebrow={post.contentType.replace(/-/g, " ")} title={post.title} body={post.summary} />
      <article className="pw-section pw-writing-detail">
        <p className="pw-kicker">{formatDate(post.publishDate)}</p>
        <div className="pw-rich-text" dangerouslySetInnerHTML={{ __html: sanitizeCmsHtml(post.body) }} />
        <div className="pw-inline-links"><Link href="/written-resources/">Back to writings</Link></div>
      </article>
    </PastorWoodShell>
  );
}
