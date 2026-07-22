import Link from "next/link";
import { notFound } from "next/navigation";

import {
  listStructuredEntriesPage,
  type StructuredEntry,
  type StructuredPagination,
} from "@/lib/strapi-structured-management";
import { getStructuredCollection } from "@/lib/structured-content-config";

export const dynamic = "force-dynamic";

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) {
    return "—";
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

function displayValue(value: unknown) {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function status(entry: StructuredEntry, publishable: boolean) {
  if (entry.archivedAt) {
    return { label: "Archived", className: "status-pill" };
  }
  if (!publishable) {
    return { label: entry.active === false ? "Inactive" : "Active", className: entry.active === false ? "status-pill" : "status-pill status-pill--good" };
  }
  if (entry.isPublished) {
    return { label: "Published", className: "status-pill status-pill--good" };
  }
  return { label: "Draft", className: "status-pill status-pill--warn" };
}

export default async function StructuredCollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ collection: string }>;
  searchParams: Promise<{ deleted?: string; page?: string; q?: string }>;
}) {
  const { collection } = await params;
  const definition = getStructuredCollection(collection);
  if (!definition) {
    notFound();
  }

  const query = await searchParams;
  const requestedPage = Math.max(1, Number.parseInt(query.page || "1", 10) || 1);
  const search = (query.q || "").trim().slice(0, 160);
  let entries: StructuredEntry[] = [];
  let pagination: StructuredPagination = { page: requestedPage, pageSize: 50, pageCount: 0, total: 0 };
  let error = "";
  try {
    const result = await listStructuredEntriesPage(definition.key, { page: requestedPage, search });
    entries = result.entries;
    pagination = result.pagination;
  } catch (cause) {
    console.error("Structured content list failed", cause);
    error = cause instanceof Error ? cause.message : "Structured content could not be loaded.";
  }
  if (!error && requestedPage > 1 && (pagination.pageCount === 0 || requestedPage > pagination.pageCount)) {
    notFound();
  }

  const publishedCount = entries.filter((entry) => entry.isPublished && !entry.archivedAt).length;
  const draftCount = entries.filter((entry) => !entry.isPublished && !entry.archivedAt).length;
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (page > 1) params.set("page", String(page));
    const suffix = params.toString();
    return suffix ? `${definition.editorPath}?${suffix}` : definition.editorPath;
  };

  return (
    <div className="stack">
      <section className="signal-board">
        <div>
          <p className="eyebrow">Content / {definition.pluralLabel}</p>
          <h1>{definition.pluralLabel}</h1>
          <p>{definition.description}</p>
        </div>
        <div className="status-list" aria-label="Content inventory summary">
          <span><strong>{pagination.total}</strong>{search ? "Matches" : "Total"}</span>
          {definition.publishable ? <span><strong>{publishedCount}</strong>Published on this page</span> : null}
          {definition.publishable ? <span><strong>{draftCount}</strong>Draft on this page</span> : null}
        </div>
      </section>

      {query.deleted ? (
        <section className="notice-card notice-card--success" role="status">
          <strong>Content deleted</strong>
          <p>The item and its live version were removed. Its audit snapshot remains available to administrators.</p>
        </section>
      ) : null}

      {error ? (
        <section className="notice-card" role="alert">
          <strong>Content service unavailable</strong>
          <p>{error}</p>
        </section>
      ) : null}

      <section className="data-card">
        <div className="data-card__header">
          <div>
            <p className="eyebrow">Structured content</p>
            <h2>Inventory</h2>
          </div>
          <div className="button-row">
            <Link className="button button--ghost" href="/content">Content home</Link>
            <Link className="button" href={`${definition.editorPath}/new`}>
              New {definition.singularLabel}
            </Link>
          </div>
        </div>

        <form className="filter-form" method="get" action={definition.editorPath} role="search">
          <label>
            <span>Search {definition.pluralLabel.toLowerCase()}</span>
            <input name="q" defaultValue={search} maxLength={160} placeholder="Title, slug, or identifier" />
          </label>
          <div className="button-row">
            <button className="button" type="submit">Search</button>
            {search ? <Link className="button button--ghost" href={definition.editorPath}>Clear</Link> : null}
          </div>
        </form>

        <div className="responsive-table" role="region" aria-label={definition.pluralLabel}>
          <table>
            <thead>
              <tr>
                <th>{definition.titleField === "name" ? "Name" : "Title"}</th>
                {definition.slugField ? <th>Slug</th> : null}
                {definition.listColumns.map((column) => <th key={column}>{column.replace(/([A-Z])/g, " $1")}</th>)}
                <th>Status</th>
                <th>Updated</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const entryStatus = status(entry, definition.publishable);
                return (
                  <tr key={entry.documentId}>
                    <td><strong>{displayValue(entry[definition.titleField])}</strong></td>
                    {definition.slugField ? <td><code>{displayValue(entry[definition.slugField])}</code></td> : null}
                    {definition.listColumns.map((column) => <td key={column}>{displayValue(entry[column])}</td>)}
                    <td><span className={entryStatus.className}>{entryStatus.label}</span></td>
                    <td>{formatDate(entry.updatedAt)}</td>
                    <td>
                      <Link className="button button--ghost" href={`${definition.editorPath}/${entry.documentId}`}>
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {!entries.length ? (
                <tr>
                  <td colSpan={5 + definition.listColumns.length}>
                    <span className="muted-copy">{error ? "No content could be loaded." : `No ${definition.pluralLabel.toLowerCase()} yet.`}</span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {pagination.pageCount > 1 ? (
          <nav className="pagination" aria-label={`${definition.pluralLabel} pages`}>
            {pagination.page > 1 ? <Link className="button button--ghost" href={pageHref(pagination.page - 1)} rel="prev">Previous</Link> : <span />}
            <span>Page {pagination.page} of {pagination.pageCount}</span>
            {pagination.page < pagination.pageCount ? <Link className="button button--ghost" href={pageHref(pagination.page + 1)} rel="next">Next</Link> : <span />}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
