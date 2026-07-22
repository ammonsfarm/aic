import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getManagedStrapiPageSummary,
  listManagedStrapiPagesPage,
  type ManagedStrapiPage,
  type ManagedStrapiPagePagination,
  type ManagedStrapiPageSummary,
} from "@/lib/strapi-management";

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

async function getPages(page: number, search: string) {
  try {
    const [result, summary] = await Promise.all([
      listManagedStrapiPagesPage({ page, search }),
      getManagedStrapiPageSummary(),
    ]);
    return { ...result, summary, error: null as string | null };
  } catch (error) {
    console.error("Page lookup failed", error);
    return {
      pages: [] as ManagedStrapiPage[],
      pagination: { page, pageSize: 50, pageCount: 0, total: 0 } as ManagedStrapiPagePagination,
      summary: { total: 0, active: 0, published: 0 } as ManagedStrapiPageSummary,
      error: error instanceof Error ? error.message : "Pages could not be loaded.",
    };
  }
}

export default async function StrapiPagesPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string; page?: string; q?: string }>;
}) {
  const query = await searchParams;
  const requestedPage = Math.max(1, Number.parseInt(query.page || "1", 10) || 1);
  const search = (query.q || "").trim().slice(0, 160);
  const { pages, pagination, summary, error } = await getPages(requestedPage, search);
  if (!error && requestedPage > 1 && (pagination.pageCount === 0 || requestedPage > pagination.pageCount)) {
    notFound();
  }
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (page > 1) params.set("page", String(page));
    const suffix = params.toString();
    return suffix ? `/content/site-pages?${suffix}` : "/content/site-pages";
  };

  return (
    <div className="stack">
      <section className="signal-board">
        <div>
          <p className="eyebrow">Content / Site Pages</p>
          <h1>Public page manager</h1>
          <p>
            Edit public website pages from AIC using the existing Content Manager role. This is the editorial workspace for page content.
          </p>
        </div>
        <div className="status-list" aria-label="Page summary">
          <span>
            <strong>{summary.total}</strong>
            Pages
          </span>
          <span>
            <strong>{summary.active}</strong>
            Active
          </span>
          <span>
            <strong>{summary.published}</strong>
            Published
          </span>
        </div>
      </section>

      {query.deleted ? (
        <section className="notice-card notice-card--success" role="status">
          <strong>Page deleted</strong>
          <p>The draft and public version were removed. The immutable audit snapshot remains available.</p>
        </section>
      ) : null}

      {error ? (
        <section className="notice-card" role="status">
          <strong>Content service unavailable</strong>
          <p>{error}</p>
        </section>
      ) : null}

      <section className="data-card">
        <div className="data-card__header">
          <div>
            <p className="eyebrow">Pages</p>
            <h2>Page inventory</h2>
          </div>
          <div className="button-row">
            <Link className="button button--ghost" href="/content">
              Back to content portal
            </Link>
            <Link className="button" href="/content/site-pages/new">
              New page
            </Link>
          </div>
        </div>

        <form className="filter-form" method="get" action="/content/site-pages" role="search">
          <label>
            <span>Search pages</span>
            <input name="q" defaultValue={search} maxLength={160} placeholder="Title, slug, or page key" />
          </label>
          <div className="button-row">
            <button className="button" type="submit">Search</button>
            {search ? <Link className="button button--ghost" href="/content/site-pages">Clear</Link> : null}
          </div>
        </form>

        <div className="responsive-table" role="region" aria-label="Site pages">
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
                    <Link className="button button--ghost" href={`/content/site-pages/${page.documentId}`}>
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
              {pages.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <span className="muted-copy">
                      {error ? "No pages could be loaded." : search ? "No pages match this search." : "No pages found."}
                    </span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {pagination.pageCount > 1 ? (
          <nav className="pagination" aria-label="Site page inventory pages">
            {pagination.page > 1 ? (
              <Link className="button button--ghost" href={pageHref(pagination.page - 1)} rel="prev">Previous</Link>
            ) : <span />}
            <span>Page {pagination.page} of {pagination.pageCount} · {pagination.total} {search ? "matches" : "pages"}</span>
            {pagination.page < pagination.pageCount ? (
              <Link className="button button--ghost" href={pageHref(pagination.page + 1)} rel="next">Next</Link>
            ) : <span />}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
