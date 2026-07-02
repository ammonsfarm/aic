import Link from "next/link";
import { notFound } from "next/navigation";

import { getManagedStrapiPage, type ManagedStrapiPage } from "@/lib/strapi-management";
import type { StrapiPageSection } from "@/lib/strapi";
import { saveStrapiPageAction } from "../actions";

export const dynamic = "force-dynamic";

const SECTION_COMPONENTS = [
  { value: "page-sections.text-section", label: "Text Section" },
  { value: "page-sections.image-text-section", label: "Image Text Section" },
  { value: "page-sections.cta-section", label: "CTA Section" },
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
    <fieldset className="section-editor">
      <legend>
        Section {index + 1}: {componentLabel(section.component)}
      </legend>
      <input type="hidden" name={`${prefix}Id`} value={section.id ?? ""} />
      <input type="hidden" name={`${prefix}ImageId`} value={imageId} />

      <div className="editor-grid editor-grid--three">
        <label>
          <span>Order</span>
          <input name={`${prefix}Order`} type="number" defaultValue={index + 1} />
        </label>
        <label>
          <span>Type</span>
          <select name={`${prefix}Component`} defaultValue={section.component}>
            {SECTION_COMPONENTS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="checkbox-row checkbox-row--form">
          <input name={`${prefix}Remove`} type="checkbox" />
          <span>Remove section</span>
        </label>
      </div>

      <div className="editor-grid editor-grid--two">
        <label>
          <span>Eyebrow</span>
          <input name={`${prefix}Eyebrow`} defaultValue={section.eyebrow} />
        </label>
        <label>
          <span>Heading</span>
          <input name={`${prefix}Heading`} defaultValue={section.heading} />
        </label>
      </div>

      <label>
        <span>Body</span>
        <textarea name={`${prefix}Body`} rows={6} defaultValue={section.body} />
      </label>

      <div className="editor-grid editor-grid--three">
        <label>
          <span>Button label</span>
          <input name={`${prefix}ButtonLabel`} defaultValue={section.buttonLabel} />
          <small>Used by CTA sections.</small>
        </label>
        <label>
          <span>Button URL</span>
          <input name={`${prefix}ButtonUrl`} defaultValue={section.buttonUrl} />
          <small>Used by CTA sections.</small>
        </label>
        <label>
          <span>Image side</span>
          <select name={`${prefix}ImageSide`} defaultValue={section.imageSide || "right"}>
            <option value="none">None</option>
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
          <small>Used by image-text sections.</small>
        </label>
      </div>

      {section.image ? (
        <div className="media-preview-row">
          <img src={section.image.url} alt={section.image.alternativeText || section.image.name || section.heading} />
          <div>
            <strong>{section.image.name || "Strapi media image"}</strong>
            <p className="muted-copy">Media ID {section.image.id ?? "unknown"}. Image replacement/upload will come in the media phase; this editor preserves the current image.</p>
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}

function NewSectionFields() {
  return (
    <fieldset className="section-editor section-editor--new">
      <legend>Add one new section</legend>
      <input type="hidden" name="newSectionOrder" value="999" />

      <div className="editor-grid editor-grid--three">
        <label>
          <span>Type</span>
          <select name="newSectionComponent" defaultValue="page-sections.text-section">
            <option value="">Do not add</option>
            {SECTION_COMPONENTS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Image media ID</span>
          <input name="newSectionImageId" type="number" inputMode="numeric" />
          <small>Optional. Use an existing Strapi media ID.</small>
        </label>
        <label>
          <span>Image side</span>
          <select name="newSectionImageSide" defaultValue="right">
            <option value="none">None</option>
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </label>
      </div>

      <div className="editor-grid editor-grid--two">
        <label>
          <span>Eyebrow</span>
          <input name="newSectionEyebrow" />
        </label>
        <label>
          <span>Heading</span>
          <input name="newSectionHeading" />
        </label>
      </div>

      <label>
        <span>Body</span>
        <textarea name="newSectionBody" rows={5} />
      </label>

      <div className="editor-grid editor-grid--two">
        <label>
          <span>Button label</span>
          <input name="newSectionButtonLabel" />
        </label>
        <label>
          <span>Button URL</span>
          <input name="newSectionButtonUrl" />
        </label>
      </div>
    </fieldset>
  );
}

async function getPage(documentId: string) {
  try {
    return { page: await getManagedStrapiPage(documentId), error: null as string | null };
  } catch (error) {
    console.error("Strapi page detail lookup failed", error);
    return {
      page: null,
      error: error instanceof Error ? error.message : "The Strapi page could not be loaded.",
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
  const { page, error } = await getPage(documentId);

  if (!page && !error) {
    notFound();
  }

  if (!page) {
    return (
      <div className="stack">
        <section className="notice-card">
          <strong>Could not load Strapi page</strong>
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
          <p className="eyebrow">Content / Strapi Pages</p>
          <h1>{page.title || "Untitled page"}</h1>
          <p>
            Edit public page content without opening the Strapi admin UI. Changes are saved to Strapi with the server-side write token.
          </p>
        </div>
        <div className="status-list" aria-label="Page status">
          <span>
            <strong>{page.active ? "Active" : "Inactive"}</strong>
            Site visibility flag
          </span>
          <span>
            <strong>{page.publishedAt ? "Published" : "Draft"}</strong>
            Strapi publish state
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
          <p>Strapi page content was updated and the AIC public page cache was revalidated.</p>
        </section>
      ) : null}

      {created ? (
        <section className="notice-card notice-card--success" role="status">
          <strong>Created</strong>
          <p>The new Strapi page was created. Add sections and connect the public route when ready.</p>
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

        <form className="editor-form" action={saveAction}>
          <div className="editor-grid editor-grid--three">
            <label>
              <span>Title</span>
              <input name="title" required defaultValue={page.title} />
            </label>
            <label>
              <span>Page key</span>
              <input name="pageKey" required defaultValue={page.pageKey} />
            </label>
            <label>
              <span>Slug</span>
              <input name="slug" required defaultValue={page.slug} />
            </label>
          </div>

          <div className="checkbox-grid">
            <label className="checkbox-row">
              <input name="active" type="checkbox" defaultChecked={page.active} />
              <span>Active</span>
            </label>
            <label className="checkbox-row">
              <input name="showInNavigation" type="checkbox" defaultChecked={page.showInNavigation} />
              <span>Show in navigation</span>
            </label>
          </div>

          <div className="editor-grid editor-grid--two">
            <label>
              <span>Navigation label</span>
              <input name="navigationLabel" defaultValue={page.navigationLabel} />
            </label>
            <label>
              <span>Navigation order</span>
              <input name="navigationOrder" type="number" inputMode="numeric" defaultValue={page.navigationOrder ?? ""} />
            </label>
          </div>

          <label>
            <span>Hero title</span>
            <input name="heroTitle" defaultValue={page.heroTitle} />
          </label>

          <label>
            <span>Hero body</span>
            <textarea name="heroBody" rows={3} defaultValue={page.heroBody} />
          </label>

          <div className="editor-grid editor-grid--two">
            <label>
              <span>SEO title</span>
              <input name="seoTitle" defaultValue={page.seoTitle} />
            </label>
            <label>
              <span>SEO description</span>
              <input name="seoDescription" defaultValue={page.seoDescription} />
            </label>
          </div>

          <input type="hidden" name="sectionCount" value={page.sections.length} />
          <div className="section-editor-list">
            <div>
              <p className="eyebrow">Sections</p>
              <h2>Page sections</h2>
              <p className="muted-copy">Edit text, CTA, and image-text sections. Image upload/replacement will come in the media-library phase.</p>
            </div>
            {page.sections.map((section, index) => (
              <SectionFields key={`${section.component}-${section.id ?? index}`} section={section} index={index} />
            ))}
            <NewSectionFields />
          </div>

          <div className="editor-form__actions">
            <button className="button" type="submit">Save Strapi page</button>
            <Link className="button button--ghost" href="/content/strapi-pages">Cancel</Link>
            <span className="muted-copy">Last updated {formatDate(page.updatedAt)}</span>
          </div>
        </form>
      </section>
    </div>
  );
}
