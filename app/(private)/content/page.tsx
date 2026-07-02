import Link from "next/link";
import { MountainPanel } from "@/components/mountain-panel";
import { requireSignedInAppUser } from "@/lib/rbac";

const contentAreas = [
  {
    title: "Site pages",
    eyebrow: "Public website",
    description:
      "Edit evergreen pages that replace the older pastorwood.org content: home, about, radio, board, endorsements, contact, donate, privacy, and ministry landing pages.",
    href: "/content/strapi-pages",
    status: "Strapi-backed editor active",
  },
  {
    title: "Posts and writings",
    eyebrow: "Devotionals / resources",
    description:
      "Create, edit, review, schedule, and publish Bible studies, written resources, devotional posts, and imported Pastor Wood articles.",
    href: "/content/posts",
    status: "Pastor Wood post tables exist; editor needed",
  },
  {
    title: "Radio and MP3 uploads",
    eyebrow: "Podcast publishing",
    description:
      "Upload new MP3s, enter metadata, attach scripture references, publish to the public archive, and hand off to transcript/vector processing.",
    href: "/content/podcast",
    status: "Needs upload workflow + storage policy",
  },
  {
    title: "Newsletters",
    eyebrow: "Email + archive",
    description:
      "Draft newsletters for the public site archive, optionally sync the final version to Mailchimp for the actual send.",
    href: "/content/newsletters",
    status: "Needs newsletter table + Mailchimp integration",
  },
  {
    title: "Media library",
    eyebrow: "Images / downloads",
    description:
      "Manage photos, logos, PDFs, audio attachments, and other reusable assets with alt text, captions, and source attribution.",
    href: "/content/media",
    status: "Needs asset table + object storage",
  },
  {
    title: "Publishing workflow",
    eyebrow: "Review / approvals",
    description:
      "Track drafts, review state, scheduled releases, public visibility, revision history, and rollback for all public content.",
    href: "/content/workflow",
    status: "Needs workflow model",
  },
];

const implementationPhases = [
  "Restructure the public site so pastorwood.ammonsfarm.org serves the replacement public website while protected console routes live under /content and /admin.",
  "Add content tables for pages, blocks, revisions, posts, newsletters, media assets, podcast uploads, and publish state.",
  "Build CRUD APIs guarded by role checks, validation, audit logging, optimistic drafts, and revision snapshots.",
  "Replace hardcoded Pastor Wood page content with database-backed page rendering using safe published versions only.",
  "Add MP3 upload and processing handoff: upload, metadata, storage, transcript job request, vectorization job request, and public episode publish.",
  "Add newsletter draft/archive support first, then add Mailchimp campaign creation/send integration after the archive model is stable.",
];

const workflowStates = ["Draft", "In review", "Scheduled", "Published", "Archived"];

export default async function ContentPortalPage() {
  const appUser = await requireSignedInAppUser();

  return (
    <div className="stack">
      <MountainPanel
        eyebrow="Content management"
        title="Pastor Wood Publishing Portal"
        body="Manage the public Pastor Wood website, writings, podcast uploads, newsletters, and reusable site content from one protected workspace."
      />

      <section className="signal-board">
        <div>
          <p className="eyebrow">Current access</p>
          <h2>{appUser.role === "Admin" ? "Administrator access" : "Signed-in content workspace"}</h2>
          <p>
            This page is protected today by the existing AIC login. The next security step should add a dedicated Content Manager role so editorial users can manage public content without receiving full system administration access.
          </p>
        </div>
        <div className="status-list" aria-label="Content portal status">
          <span>
            <strong>Public site</strong>
            Root routes remain public and published-only
          </span>
          <span>
            <strong>Content portal</strong>
            Protected under /content
          </span>
          <span>
            <strong>Admin</strong>
            Protected separately under /admin
          </span>
        </div>
      </section>

      <section className="overview-grid" aria-label="Content management areas">
        {contentAreas.map((area) => (
          <article className="overview-primary" key={area.href}>
            <p className="eyebrow">{area.eyebrow}</p>
            <h2>{area.title}</h2>
            <p>{area.description}</p>
            <div className="episode-badges" aria-label={`${area.title} status`}>
              <span>{area.status}</span>
            </div>
            <Link className="button button--ghost" href={area.href}>
              Open {area.title.toLowerCase()} →
            </Link>
          </article>
        ))}
      </section>

      <section className="split-board">
        <div>
          <p className="eyebrow">Editorial workflow</p>
          <h2>Standard publishing states</h2>
          <p>
            Every editable public item should move through the same workflow, whether it is a page section, article, MP3 episode, or newsletter archive entry.
          </p>
          <div className="coverage-list">
            {workflowStates.map((state) => (
              <span key={state}>
                <strong>{state}</strong>
                {state === "Draft" && "Private working copy"}
                {state === "In review" && "Ready for editorial or ministry review"}
                {state === "Scheduled" && "Approved for future publication"}
                {state === "Published" && "Visible on the public site"}
                {state === "Archived" && "Hidden from normal public listings"}
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="eyebrow">Role separation</p>
          <h2>Recommended access model</h2>
          <div className="coverage-list">
            <span>
              <strong>Admin</strong>
              Users, system settings, API keys, integrations, pipeline controls
            </span>
            <span>
              <strong>Content Manager</strong>
              Posts, pages, newsletters, media, podcast publish workflow
            </span>
            <span>
              <strong>Reviewer</strong>
              Review, comment, approve, but not change system settings
            </span>
            <span>
              <strong>Research User</strong>
              Current AIC sermon archive, research, compose, and RAG tools
            </span>
          </div>
        </div>
      </section>

      <section className="split-board split-board--wide">
        <div>
          <p className="eyebrow">Implementation order</p>
          <h2>Build sequence</h2>
          <div className="episode-list">
            {implementationPhases.map((phase, index) => (
              <article className="episode-row" key={phase}>
                <div>
                  <strong>Phase {index + 1}</strong>
                  <span>{phase}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
        <div>
          <p className="eyebrow">Boundary</p>
          <h2>What belongs where</h2>
          <div className="status-list status-list--wide">
            <span>
              <strong>/</strong>
              Published public Pastor Wood website
            </span>
            <span>
              <strong>/content</strong>
              Editorial CMS, podcast upload, newsletter archive, media library
            </span>
            <span>
              <strong>/admin</strong>
              Users, roles, model/API settings, integrations, system health
            </span>
            <span>
              <strong>/overview, /archive, /research, /compose</strong>
              Existing protected AIC research console, eventually linked from /content or kept as research tools
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
