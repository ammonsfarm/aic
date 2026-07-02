import Link from "next/link";

import { listManagedStrapiPages, type ManagedStrapiPage } from "@/lib/strapi-management";

export const dynamic = "force-dynamic";

function formatDate(value: string) {
  if (!value) {
    return "Not available";
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

function statusClass(page: ManagedStrapiPage) {
  if (!page.active) {
    return "status-pill";
  }

  if (page.publishedAt) {
    return "status-pill status-pill--good";
  }

  return "status-pill status-pill--warn";
}

function statusText(page: ManagedStrapiPage) {
  if (!page.active) {
    return "Inactive";
  }

  return page.publishedAt ? "Published" : "Draft";
}

async function getPages() {
  try {
    return { pages: await listManagedStrapiPages(), error: null as string | null };
  } catch (error) {
    console.error("Strapi page lookup failed", error);
    return {
      pages: [] as ManagedStrapiPage[],
      error: error instanceof Error ? error.message : "Strapi pages could not be loaded.",
    };
  }
}

export default async function StrapiPagesPage() {
  const { pages, error } = await getPages();
  const publishedCount = pages.filter((page) => page.publishedAt).length;
  const activeCount = pages.filter((page) => page.active).length;

  return (
    <div className="stack">
      <section className="signal-board">
        <div>
          <p className="eyebrow">Content / Strapi Pages</p>
          <h1>Public page manager</h1>
          <p>
            Edit Strapi-backed public pages from AIC using the existing Content Manager role. Strapi remains the content backend; this is the editorial UI.
          </p>
        </div>
        <div className="status-list" aria-label="Strapi page summary">
          <span>
            <strong>{pages.length}</strong>
            Strapi pages
          </span>
          <span>
            <strong>{activeCount}</strong>
            Active
          </span>
          <span>
            <strong>{publishedCount}</strong>
            Published
          </span>
        </div>
      </section>

      {error ? (
        <section className="notice-card" role="status">
          <strong>Strapi unavailable</strong>
          <p>{error}</p>
        </section>
      ) : null}

      <section className="data-card">
        <div className="data-card__header">
          <div>
            <p className="eyebrow">Pages</p>
            <h2>Strapi page inventory</h2>
          </div>
          <div className="button-row">
            <Link className="button button--ghost" href="/content">
              Back to content portal
            </Link>
            <Link className="button" href="/content/strapi-pages/new">
              New page
            </Link>
          </div>
        </div>

        <div className="responsive-table" role="region" aria-label="Strapi pages">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Page key</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Navigation</th>
                <th>Updated</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr key={page.documentId}>
                  <td>
                    <strong>{page.title || "Untitled"}</strong>
                  </td>
                  <td>
                    <code>{page.pageKey}</code>
                  </td>
                  <td>
                    <code>/{page.slug === "home" ? "" : page.slug}</code>
                  </td>
                  <td>
                    <span className={statusClass(page)}>{statusText(page)}</span>
                  </td>
                  <td>
                    {page.showInNavigation ? (
                      <span>{page.navigationLabel || page.title} · {page.navigationOrder ?? "no order"}</span>
                    ) : (
                      <span className="muted-copy">Hidden</span>
                    )}
                  </td>
                  <td>{formatDate(page.updatedAt)}</td>
                  <td>
                    <Link className="button button--ghost" href={`/content/strapi-pages/${page.documentId}`}>
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
              {pages.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <span className="muted-copy">No Strapi pages found.</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
