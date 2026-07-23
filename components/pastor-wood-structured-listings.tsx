import Link from "next/link";
import { notFound } from "next/navigation";

import * as PastorWoodModule from "@/components/pastor-wood-site";
import type { PastorWoodCmsPage } from "@/components/pastor-wood-site";
import {
  PUBLIC_RADIO_MAX_YEAR,
  PUBLIC_RADIO_MIN_YEAR,
  PUBLIC_RADIO_QUERY_MAX_LENGTH,
  publicRadioArchivePath,
  type PublicRadioArchiveState,
} from "@/lib/public-radio-search";
import {
  listPublishedBoardMembersResult,
  listPublishedEndorsementsResult,
  getPublishedEpisodeBySlugResult,
  listPublishedEpisodesPage,
  listPublishedPostsPage,
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
  DevotionalSignup?: (props: { sourcePath?: string }) => React.ReactNode;
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

async function StructuredUnavailable({
  cmsPage,
  eyebrow,
  title,
  body,
  showDevotionalSignup = false,
  retryHref,
}: {
  cmsPage?: PastorWoodCmsPage | null;
  eyebrow: string;
  title: string;
  body: string;
  showDevotionalSignup?: boolean;
  retryHref?: string;
}) {
  const Shell = hooks.PastorWoodShell;
  const Hero = hooks.PageHero;
  if (!Shell || !Hero) return null;
  const settings = await shellSettings();
  const Signup = hooks.DevotionalSignup;
  return (
    <Shell siteSettings={settings}>
      <Hero eyebrow={eyebrow} title={cmsPage?.heroTitle || title} body={cmsPage?.heroBody || body} />
      <section className="pw-section pw-content-unavailable" role="alert">
        <h2>Content temporarily unavailable</h2>
        <p>The public content service could not return this listing. Please try again shortly.</p>
        {retryHref ? <Link href={retryHref}>Retry this page</Link> : null}
      </section>
      {showDevotionalSignup && settings?.subscriptionEnabled !== false && Signup
        ? <Signup sourcePath="/bible-study/" />
        : null}
    </Shell>
  );
}

function PublicPagination({
  basePath,
  page,
  pageCount,
  pageHref,
  label = "Archive pages",
}: {
  basePath: string;
  page: number;
  pageCount: number;
  pageHref?: (page: number) => string;
  label?: string;
}) {
  if (pageCount <= 1) return null;
  const href = pageHref || ((targetPage: number) => `${basePath}?page=${targetPage}`);
  return (
    <nav className="pw-pagination" aria-label={label}>
      {page > 1 ? <Link href={href(page - 1)} rel="prev">Previous</Link> : <span />}
      <span>Page {page} of {pageCount}</span>
      {page < pageCount ? <Link href={href(page + 1)} rel="next">Next</Link> : <span />}
    </nav>
  );
}

export async function PastorWoodStructuredBoardPage({
  cmsPage,
}: {
  cmsPage?: PastorWoodCmsPage | null;
}) {
  const result = await listPublishedBoardMembersResult();
  const members = result.items;
  const Shell = hooks.PastorWoodShell;
  const Hero = hooks.PageHero;
  if (!Shell || !Hero) return null;
  if (!result.available) {
    return StructuredUnavailable({ cmsPage, eyebrow: "Board", title: "Abiding in Christ Board Members", body: "People serving Abiding in Christ.", retryHref: "/board-members/" });
  }

  return (
    <Shell siteSettings={await shellSettings()}>
      <Hero
        eyebrow="Board"
        title={cmsPage?.heroTitle || "Abiding in Christ Board Members"}
        body={cmsPage?.heroBody || "We are grateful for the people serving Abiding in Christ."}
      />
      <section className="pw-section">
        {members.length ? (
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
        ) : (
          <div className="pw-content-unavailable" role="status">
            <h2>No board members are published yet</h2>
            <p>Please check back for updates from Abiding in Christ.</p>
          </div>
        )}
      </section>
    </Shell>
  );
}

export async function PastorWoodStructuredEndorsementsPage({
  cmsPage,
}: {
  cmsPage?: PastorWoodCmsPage | null;
}) {
  const result = await listPublishedEndorsementsResult();
  const endorsements = result.items;
  const Shell = hooks.PastorWoodShell;
  const Hero = hooks.PageHero;
  if (!Shell || !Hero) return null;
  if (!result.available) {
    return StructuredUnavailable({ cmsPage, eyebrow: "Endorsements", title: "Endorsements for Pastor Wood", body: "Public endorsements from ministry leaders and friends of the work.", retryHref: "/endorsements/" });
  }

  return (
    <Shell siteSettings={await shellSettings()}>
      <Hero
        eyebrow="Endorsements"
        title={cmsPage?.heroTitle || "Additional Endorsements for Pastor Wood"}
        body={cmsPage?.heroBody || "Public endorsements from ministry leaders and friends of the work."}
      />
      <section className="pw-section">
        {endorsements.length ? (
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
        ) : (
          <div className="pw-content-unavailable" role="status">
            <h2>No endorsements are published yet</h2>
            <p>Please check back for future endorsements.</p>
          </div>
        )}
      </section>
    </Shell>
  );
}

export async function PastorWoodStructuredPostsPage({
  cmsPage,
  mode,
  page = 1,
}: {
  cmsPage?: PastorWoodCmsPage | null;
  mode: "devotional" | "written";
  page?: number;
}) {
  const contentType = mode === "devotional" ? "devotional" : "written-resource";
  const result = await listPublishedPostsPage(contentType, page, 24);
  const posts = result.items;
  const Shell = hooks.PastorWoodShell;
  const Hero = hooks.PageHero;
  if (!Shell || !Hero) return null;
  if (!result.available) {
    return StructuredUnavailable({
      cmsPage,
      eyebrow: mode === "devotional" ? "Weekly Devotional" : "Written Resources",
      title: mode === "devotional" ? "Weekly Devotional" : "Written Resources from Pastor Jim Wood",
      body: mode === "devotional" ? "Recent devotional posts from Pastor Wood." : "Resources intended to encourage faithful Christian living.",
      showDevotionalSignup: mode === "devotional",
      retryHref: mode === "devotional" ? "/bible-study/" : "/written-resources/",
    });
  }

  const settings = await shellSettings();
  const Signup = hooks.DevotionalSignup;
  const basePath = mode === "devotional" ? "/bible-study/" : "/written-resources/";
  const pageOutsideResults = result.total > 0 && result.pageCount > 0 && result.page > result.pageCount;
  return (
    <Shell siteSettings={settings}>
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
        {posts.length ? (
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
        ) : pageOutsideResults ? (
          <div className="pw-content-unavailable" role="status">
            <h2>This archive page has no {mode === "devotional" ? "devotionals" : "writings"}</h2>
            <p>Return to the first page of the published resources.</p>
            <Link href={basePath}>View the first page</Link>
          </div>
        ) : (
          <div className="pw-content-unavailable" role="status">
            <h2>{mode === "devotional" ? "No devotionals are published yet" : "No writings are published yet"}</h2>
            <p>Please check back for new resources from Pastor Jim Wood.</p>
          </div>
        )}
        {!pageOutsideResults ? <PublicPagination basePath={basePath} page={result.page} pageCount={result.pageCount} /> : null}
      </section>
      {mode === "devotional" && settings?.subscriptionEnabled !== false && Signup
        ? <Signup sourcePath="/bible-study/" />
        : null}
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

export async function PastorWoodStructuredRadioPage({
  slug = [],
  archive = { page: 1, query: "", year: null, hasFilters: false },
  cmsPage,
}: {
  slug?: string[];
  archive?: PublicRadioArchiveState;
  cmsPage?: PastorWoodCmsPage | null;
}) {
  const requestedSlug = slug.join("/");
  const episodeResult = requestedSlug ? await getPublishedEpisodeBySlugResult(requestedSlug) : null;
  const episode = episodeResult?.status === "found" ? episodeResult.item : null;
  const result = requestedSlug ? null : await listPublishedEpisodesPage(archive.page, 24, {
    query: archive.query,
    year: archive.year,
  });
  const episodes = result?.items || (episode ? [episode] : []);

  if (episodeResult?.status === "not-found") {
    notFound();
  }

  const Shell = hooks.PastorWoodShell;
  const Hero = hooks.PageHero;
  if (!Shell || !Hero) return null;

  if (episodeResult?.status === "unavailable") {
    return StructuredUnavailable({
      eyebrow: "Radio Archive",
      title: "This radio episode is temporarily unavailable",
      body: "The public content service could not return this broadcast.",
      retryHref: `/radio/${requestedSlug}/`,
    });
  }

  if (episode) {
    return (
      <Shell siteSettings={await shellSettings()}>
        <Hero eyebrow="Radio Archive" title={episode.title} body={episode.summary || "Listen to this Abiding in Christ broadcast."} />
        <section className="pw-section">
          <div className="pw-audio-list"><EpisodeCard episode={episode} /></div>
        </section>
      </Shell>
    );
  }

  const resultDescription = result?.available
    ? `${result.total.toLocaleString("en-US")} broadcast${result.total === 1 ? "" : "s"} found.`
    : "The archive service is temporarily unavailable.";
  const pageOutsideResults = Boolean(
    result?.available && result.total > 0 && result.pageCount > 0 && result.page > result.pageCount,
  );

  return (
    <Shell siteSettings={await shellSettings()}>
      <Hero
        eyebrow="Radio Archive"
        title={cmsPage?.heroTitle || "Radio Show Listings"}
        body={cmsPage?.heroBody || "Search and listen across the Abiding in Christ broadcast archive."}
      />
      <section className="pw-section pw-radio-layout">
        <aside className="pw-radio-intro" aria-labelledby="radio-search-title">
          <div>
            <p className="pw-kicker">Find a broadcast</p>
            <h2 id="radio-search-title">Search the radio archive</h2>
            <p>Search titles, descriptions, summaries, or track IDs. Add a year to narrow the results.</p>
          </div>
          <form className="pw-radio-search" action="/radio/" method="get" role="search" aria-label="Search radio broadcasts">
            <label>
              <span>Keywords or track ID</span>
              <input
                type="search"
                name="q"
                defaultValue={archive.query}
                maxLength={PUBLIC_RADIO_QUERY_MAX_LENGTH}
                autoComplete="off"
              />
            </label>
            <label>
              <span>Program year</span>
              <input
                type="number"
                name="year"
                defaultValue={archive.year || ""}
                min={PUBLIC_RADIO_MIN_YEAR}
                max={PUBLIC_RADIO_MAX_YEAR}
                inputMode="numeric"
              />
            </label>
            <div className="pw-radio-search__actions">
              <button className="pw-button pw-button--primary" type="submit">Search archive</button>
              {archive.hasFilters ? <Link href="/radio/">Clear filters</Link> : null}
            </div>
          </form>
          <p className="pw-radio-result-count" role="status" aria-live="polite">{resultDescription}</p>
        </aside>
        <div className="pw-radio-results">
          {!result?.available ? (
            <div className="pw-content-unavailable" role="alert">
              <h2>Radio archive temporarily unavailable</h2>
              <p>The public content service could not return broadcasts. Please try again shortly.</p>
            </div>
          ) : pageOutsideResults ? (
            <div className="pw-content-unavailable" role="status">
              <h2>This archive page has no broadcasts</h2>
              <p>Return to the first page of the current results.</p>
              <Link href={publicRadioArchivePath(archive, 1)}>View the first results page</Link>
            </div>
          ) : episodes.length ? (
            <div className="pw-audio-list">
              {episodes.map((item) => <EpisodeCard key={item.documentId} episode={item} />)}
            </div>
          ) : (
            <div className="pw-content-unavailable" role="status">
              <h2>{archive.hasFilters ? "No broadcasts match these filters" : "No broadcasts are published yet"}</h2>
              <p>{archive.hasFilters ? "Try fewer keywords, a different year, or clear the filters." : "Please check back for published broadcasts."}</p>
              {archive.hasFilters ? <Link href="/radio/">View the full archive</Link> : null}
            </div>
          )}
          {result?.available && !pageOutsideResults ? (
            <PublicPagination
              basePath="/radio/"
              page={result.page}
              pageCount={result.pageCount}
              pageHref={(targetPage) => publicRadioArchivePath(archive, targetPage)}
              label="Radio archive pages"
            />
          ) : null}
        </div>
      </section>
    </Shell>
  );
}
