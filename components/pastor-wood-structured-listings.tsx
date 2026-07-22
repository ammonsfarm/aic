import Link from "next/link";

import * as PastorWoodModule from "@/components/pastor-wood-site";
import type { PastorWoodCmsPage } from "@/components/pastor-wood-site";
import {
  listPublishedBoardMembers,
  listPublishedEndorsements,
  listPublishedEpisodes,
  listPublishedPosts,
  type PublishedEpisode,
} from "@/lib/strapi-structured-public";
import { getStrapiSiteSettings } from "@/lib/strapi-site-settings";
import type { StrapiSiteSettings } from "@/lib/strapi-site-settings";

type PastorWoodHooks = {
  PastorWoodShell?: (props: {
    children: React.ReactNode;
    siteSettings?: StrapiSiteSettings | null;
  }) => React.ReactNode;
  PageHero?: (props: {
    eyebrow: string;
    title: string;
    body: string;
  }) => React.ReactNode;
};

const hooks = PastorWoodModule as unknown as PastorWoodHooks;

function plainText(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function shellSettings() {
  try {
    return await getStrapiSiteSettings();
  } catch (error) {
    console.error("Structured public shell settings lookup failed.", error);
    return null;
  }
}

export async function PastorWoodStructuredBoardPage({
  cmsPage,
}: {
  cmsPage?: PastorWoodCmsPage | null;
}) {
  const members = await listPublishedBoardMembers();
  const Shell = hooks.PastorWoodShell;
  const Hero = hooks.PageHero;
  if (!Shell || !Hero || !members.length) {
    return <PastorWoodModule.PastorWoodContentPage page="board" cmsPage={cmsPage} />;
  }

  return (
    <Shell siteSettings={await shellSettings()}>
      <Hero
        eyebrow="Board"
        title={cmsPage?.heroTitle || "Abiding in Christ Board Members"}
        body={cmsPage?.heroBody || "We are grateful for the people serving Abiding in Christ."}
      />
      <section className="pw-section">
        <div className="pw-board-grid">
          {members.map((member) => (
            <article className="pw-board-member" key={member.documentId}>
              {member.photoUrl ? <img src={member.photoUrl} alt={member.name} /> : null}
              <div>
                <h2>{member.name}</h2>
                <p className="pw-board-role">{member.title || member.organization}</p>
                {member.biography ? <p>{plainText(member.biography)}</p> : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </Shell>
  );
}

export async function PastorWoodStructuredEndorsementsPage({
  cmsPage,
}: {
  cmsPage?: PastorWoodCmsPage | null;
}) {
  const endorsements = await listPublishedEndorsements();
  const Shell = hooks.PastorWoodShell;
  const Hero = hooks.PageHero;
  if (!Shell || !Hero || !endorsements.length) {
    return <PastorWoodModule.PastorWoodContentPage page="endorsements" cmsPage={cmsPage} />;
  }

  return (
    <Shell siteSettings={await shellSettings()}>
      <Hero
        eyebrow="Endorsements"
        title={cmsPage?.heroTitle || "Additional Endorsements for Pastor Wood"}
        body={cmsPage?.heroBody || "Public endorsements from ministry leaders and friends of the work."}
      />
      <section className="pw-section">
        <div className="pw-endorsement-grid">
          {endorsements.map((endorsement) => (
            <figure className="pw-endorsement" key={endorsement.documentId}>
              <blockquote>“{endorsement.quote}”</blockquote>
              <figcaption>
                {endorsement.photoUrl ? <img src={endorsement.photoUrl} alt="" /> : null}
                <span>
                  <strong>{endorsement.attribution}</strong>
                  {[endorsement.title, endorsement.organization].filter(Boolean).join(", ")}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </Shell>
  );
}

export async function PastorWoodStructuredPostsPage({
  cmsPage,
  mode,
}: {
  cmsPage?: PastorWoodCmsPage | null;
  mode: "devotional" | "written";
}) {
  const contentType = mode === "devotional" ? "devotional" : "written-resource";
  const posts = await listPublishedPosts(contentType);
  const Shell = hooks.PastorWoodShell;
  const Hero = hooks.PageHero;
  if (!Shell || !Hero || !posts.length) {
    return (
      <PastorWoodModule.PastorWoodContentPage
        page={mode === "devotional" ? "devotional" : "written"}
        cmsPage={cmsPage}
      />
    );
  }

  return (
    <Shell siteSettings={await shellSettings()}>
      <Hero
        eyebrow={mode === "devotional" ? "Weekly Devotional" : "Written Resources"}
        title={
          cmsPage?.heroTitle ||
          (mode === "devotional" ? "Weekly Devotional" : "Written Resources from Pastor Jim Wood")
        }
        body={
          cmsPage?.heroBody ||
          (mode === "devotional"
            ? "Recent devotional posts from Pastor Wood."
            : "Resources intended to encourage faithful Christian living.")
        }
      />
      <section className="pw-section">
        <div className="pw-post-list">
          {posts.map((post) => (
            <article className="pw-post-card" key={post.documentId}>
              <p className="pw-kicker">
                {[post.contentType.replace(/-/g, " "), post.publishDate?.slice(0, 10)].filter(Boolean).join(" · ")}
              </p>
              <h2><Link href={`/writings/${post.slug}`}>{post.title}</Link></h2>
              {post.summary ? <p>{post.summary}</p> : null}
              <Link href={`/writings/${post.slug}`}>Read writing</Link>
            </article>
          ))}
        </div>
      </section>
    </Shell>
  );
}

function EpisodeCard({ episode }: { episode: PublishedEpisode }) {
  return (
    <article className="pw-audio-card">
      <div className="pw-audio-card__meta">
        {episode.programDate ? <span>{episode.programDate}</span> : null}
        {episode.trackId ? <span>{episode.trackId}</span> : null}
      </div>
      <h2><Link href={`/radio/${episode.slug}`}>{episode.title}</Link></h2>
      {episode.summary ? <p>{episode.summary}</p> : null}
      {episode.audioUrl ? <audio controls preload="none" src={episode.audioUrl} /> : <p>Audio is temporarily unavailable.</p>}
    </article>
  );
}

export async function PastorWoodStructuredRadioPage({ slug = [] }: { slug?: string[] }) {
  const episodes = await listPublishedEpisodes();
  const Shell = hooks.PastorWoodShell;
  const Hero = hooks.PageHero;
  if (!Shell || !Hero || !episodes.length) {
    return <PastorWoodModule.PastorWoodRadioPage slug={slug} />;
  }

  const requestedSlug = slug.join("/");
  const episode = requestedSlug ? episodes.find((item) => item.slug === requestedSlug) : null;
  if (requestedSlug && !episode) {
    return <PastorWoodModule.PastorWoodRadioPage slug={slug} />;
  }

  return (
    <Shell siteSettings={await shellSettings()}>
      <Hero
        eyebrow="Radio Archive"
        title={episode?.title || "Radio Show Listings"}
        body={episode?.summary || "Listen to recent Abiding in Christ broadcasts."}
      />
      <section className="pw-section pw-radio-layout">
        <div className="pw-audio-list">
          {episode ? <EpisodeCard episode={episode} /> : episodes.map((item) => <EpisodeCard key={item.documentId} episode={item} />)}
        </div>
      </section>
    </Shell>
  );
}
