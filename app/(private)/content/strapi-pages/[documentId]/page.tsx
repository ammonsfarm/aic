import Link from "next/link";
import { notFound } from "next/navigation";

import { getManagedStrapiPage, listManagedStrapiPages, type ManagedStrapiPage } from "@/lib/strapi-management";
import type { StrapiPageSection } from "@/lib/strapi";
import { saveStrapiPageAction } from "../actions";
import { AddSectionFields, ExistingSectionTypeFields, PageCoreFields, PageEditorForm } from "../page-editor-client";

export const dynamic = "force-dynamic";

const SECTION_COMPONENTS = [
  { value: "page-sections.text-section", label: "Text" },
  { value: "page-sections.image-text-section", label: "Image + Text" },
  { value: "page-sections.cta-section", label: "Call to Action" },
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

function componentLabel(component: string) {
  return SECTION_COMPONENTS.find((item) => item.value === component)?.label ?? component;
}

function publicPath(page: ManagedStrapiPage) {
  if (page.pageKey === "about") return "/about-pastor-wood";
  if (page.pageKey === "home" || page.slug === "home") return "/";
  return `/${page.slug.replace(/^\/+/, "")}`;
}

function SectionFields({ section, index }: { section: StrapiPageSection; index: number }) {
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
      />

      {section.image ? (
        <div className="media-preview-row">
          <img src={section.image.url} alt={section.image.alternativeText || section.image.name || section.heading} />
          <div>
            <strong>{section.image.name || "Media image"}</strong>
            <p className="muted-copy">This image is currently used for the section. Upload a new image above to replace it.</p>
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}

async function getEditorData(documentId: string) {
  try {
    const [page, pages] = await Promise.all([getManagedStrapiPage(documentId), listManagedStrapiPages()]);
    return {
      page,
      existingSlugs: pages.filter((item) => item.documentId !== documentId).map((item) => item.slug).filter(Boolean),
      error: null as string | null,
    };
  } catch (error) {
    console.error("Page detail lookup failed", error);
    return {
      page: null,
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
  searchParams: Promise<{ saved?: string; created?: string }>;
}) {
  const { documentId } = await params;
  const { saved, created } = await searchParams;
  const { page, existingSlugs, error } = await getEditorData(documentId);

  if (!page && !error) {
    notFound();
  }

  if (!page) {
    return (
      <div className="stack">
        <section className="notice-card">
          <strong>Could not load page</strong>
          <p>{error}</p>
          <Link className="button button--ghost" href="/content/strapi-pages">Back to pages</Link>
        </section>
      </div>
    );
  }

  const saveAction = saveStrapiPageAction.bind(null, page.documentId);

  return (
    <div className="stack">
      <section className="signal-board">
        <div>
          <p className="eyebrow">Content / Site Pages</p>
          <h1>{page.title || "Untitled page"}</h1>
          <p>
            Edit public page content from the AIC content workspace. Changes are saved securely and update the public site cache.
          </p>
        </div>
        <div className="status-list" aria-label="Page status">
          <span>
            <strong>{page.active ? "Active" : "Inactive"}</strong>
            Site visibility flag
          </span>
          <span>
            <strong>{page.publishedAt ? "Published" : "Draft"}</strong>
            Publish state
          </span>
          <span>
            <strong>{page.sections.length}</strong>
            Sections
          </span>
        </div>
      </section>

      {saved ? (
        <section className="notice-card notice-card--success" role="status">
          <strong>Saved</strong>
          <p>Page content was updated and the public page cache was revalidated.</p>
        </section>
      ) : null}

      {created ? (
        <section className="notice-card notice-card--success" role="status">
          <strong>Created</strong>
          <p>The new page was created. Add sections and connect the public route when ready.</p>
        </section>
      ) : null}

      <section className="data-card">
        <div className="data-card__header">
          <div>
            <p className="eyebrow">Editor</p>
            <h2>Page fields</h2>
          </div>
          <div className="button-row">
            <Link className="button button--ghost" href="/content/strapi-pages">Back to pages</Link>
            <Link className="button button--ghost" href={publicPath(page)} target="_blank">View public page</Link>
          </div>
        </div>

        <PageEditorForm action={saveAction}>
          <PageCoreFields initialTitle={page.title} initialSlug={page.slug} existingSlugs={existingSlugs} />

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

          <input type="hidden" name="sectionCount" value={page.sections.length} />
          <div className="section-editor-list section-builder">
            <div>
              <p className="eyebrow">Sections</p>
              <h2>Page sections</h2>
              <p className="muted-copy">Edit, delete, reorder, or add sections. Use Text, Image + Text, or Call to Action based on what the page needs.</p>
            </div>
            {page.sections.map((section, index) => (
              <SectionFields key={`${section.component}-${section.id ?? index}`} section={section} index={index} />
            ))}
            <details className="section-add-panel">
              <summary>
                <span className="section-add-panel__icon" aria-hidden="true">+</span>
                <span>Add section</span>
              </summary>
              <div className="section-add-panel__body">
                <p className="muted-copy">Choose a section type, fill in the fields that apply, then use “+ Add Section” below to add another section before saving.</p>
                <AddSectionFields existingSectionCount={page.sections.length} />
              </div>
            </details>
          </div>

          <div className="editor-form__actions">
            <button className="button" type="submit">Save page</button>
            <Link className="button button--ghost" href="/content/strapi-pages">Cancel</Link>
            <span className="muted-copy">Last updated {formatDate(page.updatedAt)}</span>
          </div>
        </PageEditorForm>
      </section>
    </div>
  );
}
