import Link from "next/link";

import { listContentPages, type ContentPageSummary } from "@/lib/content-pages";

const fallbackPages: ContentPageSummary[] = [
  { id: 0, slug: "home", title: "Home", pageType: "standard", status: "Draft", updatedAt: "Local DB unavailable" },
  { id: 0, slug: "about-pastor-wood", title: "About Pastor Wood", pageType: "standard", status: "Published", updatedAt: "Local DB unavailable" },
  { id: 0, slug: "contact", title: "Contact", pageType: "standard", status: "Published", updatedAt: "Local DB unavailable" },
  { id: 0, slug: "donate", title: "Donate", pageType: "standard", status: "Draft", updatedAt: "Local DB unavailable" },
];

async function getPages() {
  try {
    return { pages: await listContentPages(), error: null as string | null };
  } catch (error) {
    console.error("Content pages lookup failed", error);
    return {
      pages: fallbackPages,
      error: "The local database is not reachable, so this screen is showing a small fallback inventory. Start the local database or point DB_* environment variables at a reachable Postgres instance to edit real CMS records.",
    };
  }
}

function formatDate(value: string) {
  if (value === "Local DB unavailable") {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function statusClass(status: ContentPageSummary["status"]) {
  if (status === "Published") {
    return "status-pill status-pill--good";
  }

  if (status === "Scheduled") {
    return "status-pill status-pill--warn";
  }

  return "status-pill";
}

export default async function ContentPagesPage() {
  const { pages, error } = await getPages();

  return (
    <div className="stack">
      <section className="signal-board">
        <div>
          <p className="eyebrow">Content / Pages</p>
          <h1>Site pages</h1>
          <p>
            Manage evergreen public pages such as Home, About, Radio, Contact, Donate, Board, Endorsements, and Privacy.
          </p>
        </div>
        <div className="status-list" aria-label="Page CMS status">
          <span>
            <strong>{pages.length}</strong>
            Seeded pages
          </span>
          <span>
            <strong>{pages.filter((page) => page.status === "Published").length}</strong>
            Published
          </span>
        </div>
      </section>

      {error ? (
        <section className="notice-card" role="status">
          <strong>Local database unavailable</strong>
          <p>{error}</p>
        </section>
      ) : null}

      <section className="data-card">
        <div className="data-card__header">
          <div>
            <p className="eyebrow">Public website</p>
            <h2>CMS page inventory</h2>
          </div>
          <Link className="button button--ghost" href="/content">
            Back to content portal
          </Link>
        </div>

        <div className="responsive-table" role="region" aria-label="CMS pages">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Slug</th>
                <th>Type</th>
                <th>Status</th>
                <th>Updated</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr key={`${page.slug}-${page.id}`}>
                  <td>
                    <strong>{page.title}</strong>
                  </td>
                  <td>
                    <code>/{page.slug === "home" ? "" : page.slug}</code>
                  </td>
                  <td>{page.pageType}</td>
                  <td>
                    <span className={statusClass(page.status)}>{page.status}</span>
                  </td>
                  <td>{formatDate(page.updatedAt)}</td>
                  <td>
                    {page.id > 0 ? (
                      <Link className="button button--ghost" href={`/content/pages/${page.id}`}>
                        Edit
                      </Link>
                    ) : (
                      <span className="muted-copy">DB needed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
