import Link from "next/link";

import { createStrapiPageAction } from "../actions";

export const dynamic = "force-dynamic";

export default function NewStrapiPage() {
  return (
    <div className="stack">
      <section className="signal-board">
        <div>
          <p className="eyebrow">Content / Strapi Pages</p>
          <h1>New public page</h1>
          <p>Create a Strapi-backed page. The public route still needs to exist in AIC before a new page can be visited directly.</p>
        </div>
        <div className="button-row">
          <Link className="button button--ghost" href="/content/strapi-pages">
            Back to pages
          </Link>
        </div>
      </section>

      <section className="data-card">
        <div className="data-card__header">
          <div>
            <p className="eyebrow">Page setup</p>
            <h2>Core fields</h2>
          </div>
        </div>

        <form className="editor-form" action={createStrapiPageAction}>
          <div className="editor-grid editor-grid--two">
            <label>
              <span>Title</span>
              <input name="title" required />
            </label>
            <label>
              <span>Page key</span>
              <input name="pageKey" required placeholder="example-page" />
            </label>
            <label>
              <span>Slug</span>
              <input name="slug" required placeholder="example-page" />
              <small>Use the public path segment without a leading slash.</small>
            </label>
            <label>
              <span>Navigation order</span>
              <input name="navigationOrder" type="number" inputMode="numeric" />
            </label>
          </div>

          <div className="checkbox-grid">
            <label className="checkbox-row">
              <input name="active" type="checkbox" defaultChecked />
              <span>Active</span>
            </label>
            <label className="checkbox-row">
              <input name="showInNavigation" type="checkbox" />
              <span>Show in navigation</span>
            </label>
          </div>

          <label>
            <span>Navigation label</span>
            <input name="navigationLabel" />
          </label>

          <label>
            <span>Hero title</span>
            <input name="heroTitle" />
          </label>

          <label>
            <span>Hero body</span>
            <textarea name="heroBody" rows={3} />
          </label>

          <div className="editor-grid editor-grid--two">
            <label>
              <span>SEO title</span>
              <input name="seoTitle" />
            </label>
            <label>
              <span>SEO description</span>
              <input name="seoDescription" />
            </label>
          </div>

          <input type="hidden" name="sectionCount" value="0" />
          <section className="notice-card">
            <strong>Sections can be added after creation.</strong>
            <p>Create the page first, then add text, image-text, or CTA sections from the editor screen.</p>
          </section>

          <div className="editor-form__actions">
            <button className="button" type="submit">
              Create page
            </button>
            <Link className="button button--ghost" href="/content/strapi-pages">
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </div>
  );
}
