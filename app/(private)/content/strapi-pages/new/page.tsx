import Link from "next/link";

import { listManagedStrapiPages } from "@/lib/strapi-management";
import { listReusableMediaOptions, type ReusableMediaOption } from "@/lib/strapi-structured-management";
import { createStrapiPageAction } from "../actions";
import { PageCoreFields, PageEditorForm } from "../page-editor-client";

export const dynamic = "force-dynamic";

async function getExistingSlugs() {
  try {
    const pages = await listManagedStrapiPages();
    return pages.map((page) => page.slug).filter(Boolean);
  } catch (error) {
    console.error("Page URL lookup failed", error);
    return [];
  }
}

async function getImageOptions(): Promise<ReusableMediaOption[]> {
  try {
    return (await listReusableMediaOptions()).filter((option) => option.assetType === "image" || option.mime.startsWith("image/"));
  } catch (error) {
    console.error("Reusable media lookup failed", error);
    return [];
  }
}

export default async function NewStrapiPage() {
  const [existingSlugs, imageOptions] = await Promise.all([getExistingSlugs(), getImageOptions()]);

  return (
    <div className="stack">
      <section className="signal-board">
        <div>
          <p className="eyebrow">Content / Site Pages</p>
          <h1>New public page</h1>
          <p>Create the page first with the basic page details. After it is created, you can add text, image, gallery, video, form, call-to-action, and column sections.</p>
        </div>
        <div className="button-row">
          <Link className="button button--ghost" href="/content/site-pages">
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

        <PageEditorForm action={createStrapiPageAction}>
          <PageCoreFields existingSlugs={existingSlugs} />

          <div className="checkbox-grid">
            <label className="checkbox-row">
              <input name="active" type="checkbox" defaultChecked />
              <span>Page is active</span>
            </label>
            <label className="checkbox-row">
              <input name="showInNavigation" type="checkbox" />
              <span>Show this page in menus</span>
            </label>
          </div>

          <label>
            <span>Menu label</span>
            <input name="navigationLabel" />
            <small>The short text used when this page appears in a menu. Leave blank to use the page title.</small>
          </label>

          <div className="editor-grid editor-grid--two">
            <label>
              <span>Main Section Label</span>
              <input name="heroLabel" />
              <small>Optional small label above the main title, such as Biography or Wears Valley Ranch.</small>
            </label>
            <label>
              <span>Main Section Title</span>
              <input name="heroTitle" />
              <small>The large heading at the top of the public page.</small>
            </label>
          </div>

          <label>
            <span>Main Section Body</span>
            <textarea name="heroBody" rows={3} />
            <small>Optional short introduction shown near the page headline.</small>
          </label>

          <div className="editor-grid editor-grid--three">
            <label>
              <span>Menu order</span>
              <input name="navigationOrder" type="number" inputMode="numeric" />
              <small>Optional. Lower numbers appear first in menus.</small>
            </label>
            <label>
              <span>Search result title</span>
              <input name="seoTitle" />
              <small>Optional. This can appear as the page title in browser tabs, Google results, and shared links.</small>
            </label>
            <label>
              <span>Search result description</span>
              <input name="seoDescription" />
              <small>Optional. A short summary for search engines and link previews.</small>
            </label>
          </div>

          <div className="editor-grid editor-grid--two">
            <label>
              <span>Canonical URL</span>
              <input name="canonicalUrl" type="text" placeholder="/preferred-page/" />
              <small>Optional preferred public URL. Private admin, API, and login paths are rejected.</small>
            </label>
            <label className="checkbox-row checkbox-row--form">
              <input name="noIndex" type="checkbox" />
              <span>Hide this page from search engines</span>
            </label>
          </div>

          <fieldset className="editor-field-group">
            <legend>Social sharing image</legend>
            <div className="editor-grid editor-grid--two">
              <label>
                <span>Use existing public image</span>
                <select name="socialImageLibraryId" defaultValue="">
                  <option value="">Use default site image</option>
                  {imageOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
              <label>
                <span>Or upload a new image</span>
                <input name="socialImageFile" type="file" accept="image/*" />
              </label>
            </div>
          </fieldset>

          <label>
            <span>Scheduled publication (UTC)</span>
            <input name="scheduledFor" type="datetime-local" />
            <small>Optional. Create a draft and have the background publisher release it at or after this UTC time.</small>
          </label>

          <input type="hidden" name="sectionCount" value="0" />
          <input type="hidden" name="newSectionCount" value="0" />

          <section className="notice-card">
            <strong>Sections come next.</strong>
            <p>After you create the page, open it again to build its sections and preview them before publishing.</p>
          </section>

          <label>
            <span>Creation note</span>
            <input name="changeNote" maxLength={1000} placeholder="Optional reason or source for this page" />
            <small>Saved with the initial revision and audit history.</small>
          </label>

          <div className="editor-form__actions">
            <button className="button button--ghost" type="submit" name="publicationAction" value="draft">Create draft</button>
            <button className="button" type="submit" name="publicationAction" value="publish">Create and publish</button>
            <Link className="button button--ghost" href="/content/site-pages">
              Cancel
            </Link>
          </div>
        </PageEditorForm>
      </section>
    </div>
  );
}
