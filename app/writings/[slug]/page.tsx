import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHero, PastorWoodShell } from "@/components/pastor-wood-site";
import { sanitizeCmsHtml } from "@/lib/cms-html";
import { publicMetadata } from "@/lib/public-seo";
import { getPublishedPostBySlug } from "@/lib/strapi-structured-public";

export const revalidate = 300;

function formatDate(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedPostBySlug(decodeURIComponent(slug));
  if (!post) return { robots: { index: false } };
  return publicMetadata({
    title: post.title,
    description: post.summary || "A writing from Pastor Jim Wood.",
    path: `/writings/${post.slug}/`,
    type: "article",
  });
}

export default async function WritingDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPublishedPostBySlug(decodeURIComponent(slug));
  if (!post) notFound();

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
