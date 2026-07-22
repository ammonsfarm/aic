import Link from "next/link";

import { MountainPanel } from "@/components/mountain-panel";
import { requireSignedInAppUser } from "@/lib/rbac";

const contentAreas = [
  {
    title: "Site pages",
    eyebrow: "Public pages",
    description: "Build page heroes, sections, calls to action, and navigation-safe public pages.",
    href: "/content/site-pages",
    status: "Strapi editor active",
  },
  {
    title: "Site settings",
    eyebrow: "Navigation / footer",
    description: "Manage the public site name, menus, donate action, footer copy, and shared settings.",
    href: "/content/site-settings",
    status: "Strapi editor active",
  },
  {
    title: "Posts and writings",
    eyebrow: "Devotionals / resources",
    description: "Create rich drafts, preview, publish, unpublish, archive, and restore written ministry content.",
    href: "/content/posts",
    status: "Structured workflow active",
  },
  {
    title: "Radio episodes",
    eyebrow: "Audio publishing",
    description: "Manage episode metadata, audio, public visibility, and processing state.",
    href: "/content/podcast",
    status: "Structured workflow active",
  },
  {
    title: "People and board",
    eyebrow: "People",
    description: "Manage authors, guests, staff, speakers, and board-member visibility.",
    href: "/content/people",
    status: "Structured workflow active",
  },
  {
    title: "Endorsements",
    eyebrow: "Public proof",
    description: "Manage endorsement quotes, attribution, ordering, and featured status.",
    href: "/content/endorsements",
    status: "Structured workflow active",
  },
  {
    title: "Media library",
    eyebrow: "Images / audio / documents",
    description: "Upload reusable files with alt text, rights, attribution, visibility, and legacy attachment identity.",
    href: "/content/media",
    status: "Private-by-default library active",
  },
  {
    title: "Legacy redirects",
    eyebrow: "Migration",
    description: "Map verified old PastorWood paths to replacement destinations without redirect loops.",
    href: "/content/redirects",
    status: "Redirect registry active",
  },
  {
    title: "Publishing workflow",
    eyebrow: "Audit / revisions",
    description: "Review drafts, published and archived items, attribution, and recent editorial actions.",
    href: "/content/workflow",
    status: "Audit workflow active",
  },
  {
    title: "Devotional subscribers",
    eyebrow: "Consent / export",
    description: "Export consented weekly devotional subscribers without exposing request fingerprints or changing suppression status.",
    href: "/content/newsletters",
    status: "Consent capture active",
  },
];

export default async function ContentPortalPage() {
  const appUser = await requireSignedInAppUser();

  return (
    <div className="stack">
      <MountainPanel
        eyebrow="Content management"
        title="Pastor Wood Publishing Portal"
        body="Build and publish the public Pastor Wood website from a protected workspace backed by Strapi."
      />

      <section className="signal-board">
        <div>
          <p className="eyebrow">Current access</p>
          <h2>{appUser.role}</h2>
          <p>
            Content Managers and Administrators can edit and publish ministry content. System administration remains restricted to Administrators.
          </p>
        </div>
        <div className="status-list" aria-label="Content workflow guarantees">
          <span><strong>Draft first</strong>Saving never publishes implicitly</span>
          <span><strong>Explicit release</strong>Publish and unpublish are separate actions</span>
          <span><strong>Attributed</strong>Revisions and lifecycle actions record the editor</span>
          <span><strong>Private media</strong>Uploads are not public by default</span>
        </div>
      </section>

      <section className="overview-grid" aria-label="Content management areas">
        {contentAreas.map((area) => (
          <article className="overview-primary" key={area.href}>
            <p className="eyebrow">{area.eyebrow}</p>
            <h2>{area.title}</h2>
            <p>{area.description}</p>
            <div className="episode-badges" aria-label={`${area.title} status`}><span>{area.status}</span></div>
            <Link className="button button--ghost" href={area.href}>Open {area.title.toLowerCase()} →</Link>
          </article>
        ))}
      </section>
    </div>
  );
}
