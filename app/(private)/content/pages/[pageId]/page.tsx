import Link from "next/link";
import { notFound } from "next/navigation";

import { getContentPageById, getLatestContentPageRevision } from "@/lib/content-pages";
import { savePageDraftAction } from "./actions";

async function loadCmsPage(pageId: string) {
  const numericPageId = Number(pageId);
  if (!Number.isInteger(numericPageId) || numericPageId <= 0) {
    notFound();
  }

  try {
    const page = await getContentPageById(numericPageId);
    const latestRevision = page ? await getLatestContentPageRevision(page.id) : null;
    return { page, latestRevision, error: null as string | null };
  } catch (error) {
    console.error("Content page detail lookup failed", error);
    return {
      page: null,
      latestRevision: null,
      error: "The database is not reachable, so this editor cannot load the selected CMS record.",
    };
  }
}

export default async function ContentPageDetail({
  params,
  searchParams,
}: {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { pageId } = await params;
  const { saved } = await searchParams;
  const { page, latestRevision, error } = await loadCmsPage(pageId);

  if (!page && !error) {
    notFound();
  }

  const editRevision = latestRevision ?? page?.revision ?? null;
  const publicHref = page ? `/${page.slug === "home" ? "" : page.slug}` : "/";

  return (
    <div className="stack">
      <section className="signal-board">
        <div>
          <p className="eyebrow">Content / Pages</p>
          <h1>{page ? `Edit ${page.title}` : "Page editor"}</h1>
          <p>
            Save changes as a draft revision first. Published public pages continue to use the current published revision until a draft is explicitly published.
          </p>
        </div>
        <div className="status-list" aria-label="Page status">
          <span>
            <strong>{page?.status ?? "Unavailable"}</strong>
            Current page status
          </span>
          <span>
            <strong>{page?.revision ? `Revision ${page.revision.revisionNumber}` : "None"}</strong>
            Published revision
          </span>
          <span>
            <strong>{latestRevision ? `Revision ${latestRevision.revisionNumber}` : "None"}</strong>
            Latest revision
          </span>
        </div>
      </section>

      {saved ? (
        <section className="notice-card notice-card--success" role="status">
          <strong>Draft saved</strong>
          <p>Revision {saved} was saved as a draft. It is not public until you publish it.</p>
        </section>
      ) : null}

      {error ? (
        <section className="notice-card" role="status">
          <strong>Database unavailable</strong>
          <p>{error}</p>
          <Link className="button button--ghost" href="/content/pages">
            Back to pages
          </Link>
        </section>
      ) : null}

      {page ? (
        <section className="data-card">
          <div className="data-card__header">
            <div>
              <p className="eyebrow">CMS page record</p>
              <h2>Editable fields</h2>
            </div>
            <div className="button-row">
              <Link className="button button--ghost" href="/content/pages">
                Back to pages
              </Link>
              <Link className="button button--ghost" href={publicHref}>
                View public page
              </Link>
            </div>
          </div>

          <form action={savePageDraftAction} className="editor-form">
            <input type="hidden" name="pageId" value={page.id} />
            <label>
              <span>Title</span>
              <input name="title" defaultValue={editRevision?.title ?? page.title} required />
            </label>
            <label>
              <span>Slug</span>
              <input name="slug" defaultValue={page.slug} disabled />
              <small>Slug editing will be added after draft slug support is added to the schema.</small>
            </label>
            <label>
              <span>Hero title</span>
              <input name="heroTitle" defaultValue={editRevision?.heroTitle ?? ""} required />
            </label>
            <label>
              <span>Hero body</span>
              <textarea name="heroBody" rows={5} defaultValue={editRevision?.heroBody ?? ""} />
            </label>
            <label>
              <span>SEO title</span>
              <input name="seoTitle" defaultValue={editRevision?.seoTitle ?? ""} />
            </label>
            <label>
              <span>SEO description</span>
              <textarea name="seoDescription" rows={3} defaultValue={editRevision?.seoDescription ?? ""} />
            </label>
            <label>
              <span>Change note</span>
              <input name="changeNote" placeholder="Example: Updated hero copy" />
            </label>
            <div className="editor-form__actions">
              <button className="button button--primary" type="submit">
                Save Draft
              </button>
              <span className="muted-copy">Publish is the next step after draft saves.</span>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
