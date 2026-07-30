import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getManagedStrapiPage,
  listManagedStrapiPageRevisions,
  listManagedStrapiPages,
  type ManagedStrapiPage,
} from "@/lib/strapi-management";
import { pastorWoodPublicCmsCutoverEnabled } from "@/lib/pastorwood-public-cms-cutover";
import { listReusableMediaOptions, type ReusableMediaOption } from "@/lib/strapi-structured-management";
import type { StrapiPageSection } from "@/lib/strapi";
import {
  deleteStrapiPageAction,
  rollbackStrapiPageAction,
  saveStrapiPageAction,
  transitionStrapiPageAction,
} from "../actions";
import { AddSectionFields, ExistingSectionTypeFields, PageCoreFields, PageEditorForm } from "../page-editor-client";

export const dynamic = "force-dynamic";

const SECTION_COMPONENTS = [
  { value: "page-sections.text-section", label: "Text" },
  { value: "page-sections.image-text-section", label: "Image + Text" },
  { value: "page-sections.cta-section", label: "Call to Action" },
  { value: "page-sections.gallery-section", label: "Gallery" },
  { value: "page-sections.embed-section", label: "Video Embed" },
  { value: "page-sections.form-section", label: "Form" },
  { value: "page-sections.columns-section", label: "Columns" },
];

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

function formatDateTimeInput(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16);
}

function componentLabel(component: string) {
  return SECTION_COMPONENTS.find((item) => item.value === component)?.label ?? component;
}

function publicPath(page: ManagedStrapiPage) {
  if (page.pageKey === "about") return "/about-pastor-wood";
  if (page.pageKey === "home" || page.slug === "home") return "/";
  return `/${page.slug.replace(/^\/+/, "")}`;
}

function SectionFields({ section, index, mediaOptions }: { section: StrapiPageSection; index: number; mediaOptions: ReusableMediaOption[] }) {
  const prefix = `section${index}`;
  const imageId = section.image?.id ?? "";

  return (
    <fieldset className="section-editor section-component-card">
      <legend className="sr-only">
        Section {index + 1}: {componentLabel(section.component)}
      </legend>
      <input type="hidden" name={`${prefix}Id`} value={section.id ?? ""} />
      <input type="hidden" name={`${prefix}ImageId`} value={imageId} />

      <div className="section-component-card__header">
        <div className="section-component-card__title">
          <span className="component-icon" aria-hidden="true">▦</span>
          <span>{componentLabel(section.component)}</span>
          <span className="muted-copy">Section {index + 1}</span>
        </div>
        <label className="section-delete-toggle">
          <input name={`${prefix}Remove`} type="checkbox" />
          <span>Delete</span>
        </label>
      </div>

      <input type="hidden" name={`${prefix}Component`} value={section.component} />
      <label>
        <span>Display order</span>
        <input name={`${prefix}Order`} type="number" defaultValue={index + 1} />
        <small>Lower numbers appear higher on the page.</small>
      </label>

      <div className="editor-grid editor-grid--two">
        <label>
          <span>Small intro label</span>
          <input name={`${prefix}Eyebrow`} defaultValue={section.eyebrow} />
          <small>Optional short label above the section title, such as “About” or “Resources.”</small>
        </label>
        <label>
          <span>Section title</span>
          <input name={`${prefix}Heading`} defaultValue={section.heading} />
        </label>
      </div>

      <ExistingSectionTypeFields
        prefix={prefix}
        component={section.component}
        body={section.body}
        buttonLabel={section.buttonLabel}
        buttonUrl={section.buttonUrl}
        imageSide={section.imageSide}
        imageDescription={section.imageDescription}
        imageName={section.image?.name || "current image"}
        imageUrl={section.image?.url}
        imageAlt={section.image?.alternativeText || section.heading}
        images={section.images}
        galleryColumns={section.galleryColumns}
        embedUrl={section.embedUrl}
        embedTitle={section.embedTitle}
        embedAspectRatio={section.embedAspectRatio}
        formType={section.formType}
        columnCount={section.columnCount}
        columnOneHeading={section.columnOneHeading}
        columnOneBody={section.columnOneBody}
        columnTwoHeading={section.columnTwoHeading}
        columnTwoBody={section.columnTwoBody}
        columnThreeHeading={section.columnThreeHeading}
        columnThreeBody={section.columnThreeBody}
        mediaOptions={mediaOptions}
      />
    </fieldset>
  );
}

async function getEditorData(documentId: string) {
  try {
    const [page, pages, revisions] = await Promise.all([
      getManagedStrapiPage(documentId),
      listManagedStrapiPages(),
      listManagedStrapiPageRevisions(documentId),
    ]);
    let mediaOptions: ReusableMediaOption[] = [];
    try {
      mediaOptions = await listReusableMediaOptions();
    } catch (mediaError) {
      console.error("Reusable media lookup failed", mediaError);
    }
    return {
      page,
      revisions,
      mediaOptions,
      existingSlugs: pages.filter((item) => item.documentId !== documentId).map((item) => item.slug).filter(Boolean),
      error: null as string | null,
    };
  } catch (error) {
    console.error("Page detail lookup failed", error);
    return {
      page: null,
      revisions: [],
      mediaOptions: [] as ReusableMediaOption[],
      existingSlugs: [] as string[],
      error: error instanceof Error ? error.message : "The page could not be loaded.",
    };
  }
}

export default async function EditStrapiPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ state?: string }>;
}) {
  const { documentId } = await params;
  const { state } = await searchParams;
  const { page, revisions, mediaOptions, existingSlugs, error } = await getEditorData(documentId);
  const imageOptions = mediaOptions.filter((option) => option.assetType === "image" || option.mime.startsWith("image/"));

  if (!page && !error) {
    notFound();
  }

  if (!page) {
    return (
      <div className="stack">
        <section className="notice-card">
          <strong>Could not load page</strong>
          <p>{error}</p>
          <Link className="button button--ghost" href="/content/site-pages">Back to pages</Link>
        </section>
      </div>
    );
  }

  const publicCutoverReady = pastorWoodPublicCmsCutoverEnabled();
  const publishedMessage = publicCutoverReady
    ? "The latest page content is now public."
    : "The page is published in CMS, but public CMS routing is disabled in this pre-cutover environment. Use the protected draft preview until the reviewed cutover is enabled.";
  const createdPublishedMessage = publicCutoverReady
    ? "The new page is now public."
    : "The new page is published in CMS, but public CMS routing is disabled in this pre-cutover environment. Use the protected draft preview until the reviewed cutover is enabled.";
  const saveAction = saveStrapiPageAction.bind(null, page.documentId);
  const notice = {
    "draft-saved": ["Draft saved", "The draft was saved. The public page was not changed."],
    published: [publicCutoverReady ? "Published" : "Published in CMS", publishedMessage],
    unpublished: ["Unpublished", "The public version was removed. The draft is still available here."],
    "created-draft": ["Draft created", "The new page is private until you publish it."],
    "created-published": [publicCutoverReady ? "Created and published" : "Created and published in CMS", createdPublishedMessage],
    archived: ["Archived", "The page is retained with its history but is no longer public."],
    restored: ["Restored", "The page is active as a draft and can be published when ready."],
    "rolled-back": ["Revision restored", "The selected revision is now the current draft. Review it before publishing."],
  }[state ?? ""];


  return (
    <div className="stack">
      <section className="signal-board">
        <div>
          <p className="eyebrow">Content / Site Pages</p>
          <h1>{page.title || "Untitled page"}</h1>
          <p>Edit the draft, preview it safely, and publish only when the page is ready for visitors.</p>
        </div>
        <div className="status-list" aria-label="Page status">
          <span>
            <strong>{page.active ? "Active" : "Inactive"}</strong>
            Site visibility flag
          </span>
          <span>
            <strong>{page.publicationStatus === "published" ? "Published" : "Draft only"}</strong>
            Publish state
          </span>
          <span>
            <strong>{page.sections.length}</strong>
            Sections
          </span>
        </div>
      </section>

      {notice ? (
        <section className="notice-card notice-card--success" role="status">
          <strong>{notice[0]}</strong>
          <p>{notice[1]}</p>
        </section>
      ) : null}

      <section className="data-card">
        <div className="data-card__header">
          <div>
            <p className="eyebrow">Editor</p>
            <h2>Page fields</h2>
          </div>
          <div className="button-row">
            <Link className="button button--ghost" href="/content/site-pages">Back to pages</Link>
            <Link className="button button--ghost" href={`/preview/site-pages/${page.documentId}`} target="_blank">Preview draft</Link>
            {page.publicationStatus === "published" && publicCutoverReady ? <Link className="button button--ghost" href={publicPath(page)} target="_blank">View public page</Link> : null}
          </div>
        </div>
        {page.publicationStatus === "published" && !publicCutoverReady ? (
          <p className="muted-copy" role="status">
            Published in CMS. Public CMS routing is disabled in this pre-cutover environment. Use Preview draft until the reviewed cutover is enabled.
          </p>
        ) : null}

        <PageEditorForm action={saveAction}>
          <input type="hidden" name="expectedUpdatedAt" value={page.updatedAt} />
          <PageCoreFields initialTitle={page.title} initialSlug={page.slug} initialPageKey={page.pageKey} existingSlugs={existingSlugs} />

          <div className="checkbox-grid">
            <label className="checkbox-row">
              <input name="active" type="checkbox" defaultChecked={page.active} />
              <span>Page is active</span>
            </label>
            <label className="checkbox-row">
              <input name="showInNavigation" type="checkbox" defaultChecked={page.showInNavigation} />
              <span>Show this page in menus</span>
            </label>
          </div>

          <div className="editor-grid editor-grid--two">
            <label>
              <span>Menu label</span>
              <input name="navigationLabel" defaultValue={page.navigationLabel} />
              <small>Optional. Use this if the menu should say something shorter than the page title.</small>
            </label>
            <label>
              <span>Menu order</span>
              <input name="navigationOrder" type="number" inputMode="numeric" defaultValue={page.navigationOrder ?? ""} />
              <small>Optional. Lower numbers appear first in menus.</small>
            </label>
          </div>

          <div className="editor-grid editor-grid--two">
            <label>
              <span>Canonical URL</span>
              <input name="canonicalUrl" type="text" defaultValue={page.canonicalUrl} placeholder={`/${page.slug}/`} />
              <small>Optional preferred public URL. Private admin, API, and login paths are rejected.</small>
            </label>
            <label className="checkbox-row checkbox-row--form">
              <input name="noIndex" type="checkbox" defaultChecked={page.noIndex} />
              <span>Hide this page from search engines</span>
            </label>
          </div>

          <fieldset className="editor-field-group">
            <legend>Social sharing image</legend>
            {page.socialImage?.url ? (
              <div className="media-editor-card__preview">
                <img src={page.socialImage.url} alt={page.socialImage.alternativeText || page.socialImage.name || "Current social sharing image"} />
              </div>
            ) : null}
            <div className="editor-grid editor-grid--two">
              <label>
                <span>Use existing public image</span>
                <select name="socialImageLibraryId" defaultValue="">
                  <option value="">{page.socialImage ? "Keep current image" : "Use default site image"}</option>
                  {imageOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
              <label>
                <span>Or upload a new image</span>
                <input name="socialImageFile" type="file" accept="image/*" />
              </label>
            </div>
            {page.socialImage ? (
              <label className="checkbox-row checkbox-row--form">
                <input name="removeSocialImage" type="checkbox" />
                <span>Remove the current social image and use the site default</span>
              </label>
            ) : null}
          </fieldset>

          <div className="editor-grid editor-grid--two">
            <label>
              <span>Main Section Label</span>
              <input name="heroLabel" defaultValue={page.heroLabel} />
              <small>Optional small label above the main title, such as Biography or Wears Valley Ranch.</small>
            </label>
            <label>
              <span>Main Section Title</span>
              <input name="heroTitle" defaultValue={page.heroTitle} />
              <small>The large heading at the top of the public page.</small>
            </label>
          </div>

          <label>
            <span>Main Section Body</span>
            <textarea name="heroBody" rows={3} defaultValue={page.heroBody} />
            <small>Optional short introduction shown near the page headline.</small>
          </label>

          <div className="editor-grid editor-grid--two">
            <label>
              <span>Search result title</span>
              <input name="seoTitle" defaultValue={page.seoTitle} />
              <small>Optional. This can appear as the page title in browser tabs, Google results, and shared links.</small>
            </label>
            <label>
              <span>Search result description</span>
              <input name="seoDescription" defaultValue={page.seoDescription} />
              <small>Optional. A short summary for search engines and link previews.</small>
            </label>
          </div>

          <label>
            <span>Scheduled publication (UTC)</span>
            <input name="scheduledFor" type="datetime-local" defaultValue={formatDateTimeInput(page.scheduledFor)} />
            <small>Optional. The background publisher releases this draft at or after the selected UTC time. Clear it to cancel the schedule.</small>
          </label>

          <input type="hidden" name="sectionCount" value={page.sections.length} />
          <div className="section-editor-list section-builder">
            <div>
              <p className="eyebrow">Sections</p>
              <h2>Page sections</h2>
              <p className="muted-copy">Edit, delete, reorder, or add text, image, call-to-action, gallery, video, form, and column sections.</p>
            </div>
            {page.sections.map((section, index) => (
              <SectionFields key={`${section.component}-${section.id ?? index}`} section={section} index={index} mediaOptions={imageOptions} />
            ))}
            <details className="section-add-panel">
              <summary>
                <span className="section-add-panel__icon" aria-hidden="true">+</span>
                <span>Add section</span>
              </summary>
              <div className="section-add-panel__body">
                <p className="muted-copy">Choose a section type, fill in the fields that apply, then use “+ Add Section” below to add another section before saving.</p>
                <AddSectionFields existingSectionCount={page.sections.length} mediaOptions={imageOptions} />
              </div>
            </details>
          </div>

          <label>
            <span>Change note</span>
            <input name="changeNote" maxLength={1000} placeholder="Optional reason for this revision" />
            <small>Saved with the immutable revision and audit history.</small>
          </label>

          <div className="editor-form__actions">
            <button className="button button--ghost" type="submit" name="publicationAction" value="draft">Save draft</button>
            {!page.archivedAt ? <button className="button" type="submit" name="publicationAction" value="publish">Publish</button> : null}
            {page.publicationStatus === "published" ? <button className="button button--ghost" type="submit" name="publicationAction" value="unpublish">Unpublish</button> : null}
            <Link className="button button--ghost" href="/content/site-pages">Cancel</Link>
            <span className="muted-copy">Last updated {formatDate(page.updatedAt)}</span>
          </div>
        </PageEditorForm>
      </section>

      <section className="data-card stack">
        <div className="data-card__header">
          <div>
            <p className="eyebrow">Lifecycle</p>
            <h2>Archive, restore, and history</h2>
          </div>
        </div>
        <div className="button-row">
          {page.archivedAt ? (
            <form action={transitionStrapiPageAction.bind(null, page.documentId, "restore")}>
              <input type="hidden" name="expectedUpdatedAt" value={page.updatedAt} />
              <input type="hidden" name="transitionNote" value="Restored from the page builder." />
              <button className="button" type="submit">Restore as draft</button>
            </form>
          ) : (
            <form action={transitionStrapiPageAction.bind(null, page.documentId, "archive")}>
              <input type="hidden" name="expectedUpdatedAt" value={page.updatedAt} />
              <label>
                <span>Archive reason</span>
                <input name="transitionNote" maxLength={1000} required />
              </label>
              <button className="button button--ghost" type="submit">Archive page</button>
            </form>
          )}
        </div>

        <div className="table-wrap">
          <table>
            <thead><tr><th>Revision</th><th>Action</th><th>Editor</th><th>Date</th><th>Restore</th></tr></thead>
            <tbody>
              {revisions.map((revision) => (
                <tr key={revision.documentId}>
                  <td>#{revision.revisionNumber}</td>
                  <td>{revision.action}{revision.note ? <small className="table-subline">{revision.note}</small> : null}</td>
                  <td>{revision.actorName || revision.actorEmail}</td>
                  <td>{formatDate(revision.createdAt)}</td>
                  <td>
                    <form action={rollbackStrapiPageAction.bind(null, page.documentId, revision.documentId)}>
                      <input type="hidden" name="expectedUpdatedAt" value={page.updatedAt} />
                      <input type="hidden" name="rollbackNote" value={`Restored revision ${revision.revisionNumber}.`} />
                      <button className="button button--ghost" type="submit">Restore draft</button>
                    </form>
                  </td>
                </tr>
              ))}
              {revisions.length === 0 ? <tr><td colSpan={5}>No revisions have been recorded yet.</td></tr> : null}
            </tbody>
          </table>
        </div>

        <details className="notice-card notice-card--error">
          <summary>Delete this page permanently</summary>
          <form className="stack" action={deleteStrapiPageAction.bind(null, page.documentId, page.title)}>
            <input type="hidden" name="expectedUpdatedAt" value={page.updatedAt} />
            <p>Type <strong>{page.title}</strong> exactly. The immutable audit event remains after deletion.</p>
            <label>
              <span>Page title confirmation</span>
              <input name="deleteConfirmation" required autoComplete="off" />
            </label>
            <label>
              <span>Deletion reason</span>
              <input name="deleteNote" maxLength={1000} required />
            </label>
            <button className="button button--danger" type="submit">Delete page</button>
          </form>
        </details>
      </section>
    </div>
  );
}
