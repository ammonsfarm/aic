import Link from "next/link";

import type { ManagedStrapiPage } from "@/lib/strapi-management";
import {
  getManagedSiteSettings,
  listSiteSettingsPageOptions,
  type ManagedNavigationItem,
  type ManagedSiteSettings,
} from "@/lib/strapi-site-settings-management";
import { saveSiteSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

type NavigationGroupName = "topNavigation" | "utilityNavigation" | "footerNavigation";

const NAVIGATION_GROUPS: Array<{ name: NavigationGroupName; title: string; description: string }> = [
  {
    name: "topNavigation",
    title: "Top navigation",
    description: "Primary header links shown across the public site.",
  },
  {
    name: "utilityNavigation",
    title: "Utility navigation",
    description: "The home-page link band and secondary ministry links.",
  },
  {
    name: "footerNavigation",
    title: "Footer navigation",
    description: "Footer links shown near the bottom of the public site.",
  },
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

function pageOptionLabel(page: ManagedStrapiPage) {
  const path = page.slug === "home" ? "/" : `/${page.slug}`;
  return `${page.title || page.pageKey || page.slug} (${path})`;
}

function NavigationItemFields({
  groupName,
  index,
  item,
  pages,
}: {
  groupName: NavigationGroupName;
  index: number;
  item: ManagedNavigationItem;
  pages: ManagedStrapiPage[];
}) {
  const prefix = `${groupName}${index}`;

  return (
    <fieldset className="section-editor">
      <legend>{item.label || `Navigation item ${index + 1}`}</legend>
      <input type="hidden" name={`${prefix}Id`} value={item.id ?? ""} />

      <div className="editor-grid editor-grid--three">
        <label>
          <span>Order</span>
          <input name={`${prefix}Order`} type="number" inputMode="numeric" defaultValue={item.order ?? ""} />
        </label>
        <label>
          <span>Label</span>
          <input name={`${prefix}Label`} defaultValue={item.label} />
        </label>
        <label>
          <span>Direct URL</span>
          <input name={`${prefix}Url`} defaultValue={item.url} placeholder="/contact or https://example.com" />
        </label>
      </div>

      <div className="editor-grid editor-grid--three">
        <label>
          <span>Linked site page</span>
          <select name={`${prefix}PageDocumentId`} defaultValue={item.pageDocumentId}>
            <option value="">No linked page</option>
            {pages.map((page) => (
              <option key={page.documentId} value={page.id ?? page.documentId}>
                {pageOptionLabel(page)}
              </option>
            ))}
          </select>
          <small>If selected, the public site uses the linked page route before the direct URL.</small>
        </label>
        <label className="checkbox-row checkbox-row--form">
          <input name={`${prefix}Active`} type="checkbox" defaultChecked={item.active} />
          <span>Active</span>
        </label>
        <label className="checkbox-row checkbox-row--form">
          <input name={`${prefix}Remove`} type="checkbox" />
          <span>Remove item</span>
        </label>
      </div>

      {item.pageDocumentId ? (
        <p className="muted-copy">
          Currently linked to {item.pageTitle || item.pageDocumentId}
          {item.pageSlug ? ` (${item.pageSlug === "home" ? "/" : `/${item.pageSlug}`})` : ""}.
        </p>
      ) : null}
    </fieldset>
  );
}

function NewNavigationItemFields({
  groupName,
  pages,
}: {
  groupName: NavigationGroupName;
  pages: ManagedStrapiPage[];
}) {
  const prefix = `${groupName}New`;

  return (
    <fieldset className="section-editor section-editor--new">
      <legend>Add one new item</legend>
      <div className="editor-grid editor-grid--three">
        <label>
          <span>Order</span>
          <input name={`${prefix}Order`} type="number" inputMode="numeric" />
        </label>
        <label>
          <span>Label</span>
          <input name={`${prefix}Label`} />
        </label>
        <label>
          <span>Direct URL</span>
          <input name={`${prefix}Url`} placeholder="/contact or https://example.com" />
        </label>
      </div>
      <div className="editor-grid editor-grid--two">
        <label>
          <span>Linked site page</span>
          <select name={`${prefix}PageDocumentId`} defaultValue="">
            <option value="">No linked page</option>
            {pages.map((page) => (
              <option key={page.documentId} value={page.id ?? page.documentId}>
                {pageOptionLabel(page)}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-row checkbox-row--form">
          <input name={`${prefix}Active`} type="checkbox" defaultChecked />
          <span>Active</span>
        </label>
      </div>
    </fieldset>
  );
}

function NavigationGroupEditor({
  group,
  settings,
  pages,
}: {
  group: (typeof NAVIGATION_GROUPS)[number];
  settings: ManagedSiteSettings;
  pages: ManagedStrapiPage[];
}) {
  const items = settings[group.name];
  const sortedItems = [...items].sort((left, right) => (left.order ?? 9999) - (right.order ?? 9999));

  return (
    <section className="section-editor-list">
      <div>
        <p className="eyebrow">Navigation</p>
        <h2>{group.title}</h2>
        <p className="muted-copy">{group.description} Numeric order controls public display order.</p>
      </div>
      <input type="hidden" name={`${group.name}Count`} value={sortedItems.length} />
      {sortedItems.map((item, index) => (
        <NavigationItemFields
          key={`${group.name}-${item.id ?? index}-${item.label}`}
          groupName={group.name}
          index={index}
          item={item}
          pages={pages}
        />
      ))}
      <NewNavigationItemFields groupName={group.name} pages={pages} />
    </section>
  );
}

async function getEditorData() {
  try {
    const [settings, pages] = await Promise.all([getManagedSiteSettings(), listSiteSettingsPageOptions()]);
    return { settings, pages, error: null as string | null };
  } catch (error) {
    console.error("Site settings lookup failed", error);
    return {
      settings: null,
      pages: [] as ManagedStrapiPage[],
      error: error instanceof Error ? error.message : "Site settings could not be loaded.",
    };
  }
}

export default async function SiteSettingsPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const { settings, pages, error } = await getEditorData();

  if (!settings) {
    return (
      <div className="stack">
        <section className="notice-card">
          <strong>Could not load site settings</strong>
          <p>{error ?? "The site settings record was not returned."}</p>
          <Link className="button button--ghost" href="/content">Back to content portal</Link>
        </section>
      </div>
    );
  }

  const navigationCount =
    settings.topNavigation.length + settings.utilityNavigation.length + settings.footerNavigation.length;

  return (
    <div className="stack">
      <section className="signal-board">
        <div>
          <p className="eyebrow">Content / Site Settings</p>
          <h1>Site settings and navigation</h1>
          <p>Edit and preview the draft, then publish navigation and global settings when they are ready.</p>
        </div>
        <div className="status-list" aria-label="Site settings summary">
          <span>
            <strong>{settings.siteName}</strong>
            Site name
          </span>
          <span>
            <strong>{navigationCount}</strong>
            Navigation items
          </span>
          <span>
            <strong>{settings.showDonateButton ? "Visible" : "Hidden"}</strong>
          <span>
            <strong>{settings.publicationStatus === "published" ? "Published" : "Draft only"}</strong>
            Publish state
          </span>
            Donate button
          </span>
        </div>
      </section>

      {state ? (
        <section className="notice-card notice-card--success" role="status">
          <strong>{state === "published" ? "Published" : state === "unpublished" ? "Unpublished" : "Draft saved"}</strong>
          <p>
            {state === "published"
              ? "The latest site settings are now public."
              : state === "unpublished"
                ? "The public settings were removed; the draft remains available."
                : "The draft was saved. The public site was not changed."}
          </p>
        </section>
      ) : null}

      <section className="data-card">
        <div className="data-card__header">
          <div>
            <p className="eyebrow">Editor</p>
            <h2>Global site fields</h2>
          </div>
          <div className="button-row">
            <Link className="button button--ghost" href="/content">Back to content portal</Link>
            <Link className="button button--ghost" href="/preview/site-settings" target="_blank">Preview draft</Link>
            {settings.publicationStatus === "published" ? <Link className="button button--ghost" href="/" target="_blank">View public site</Link> : null}
          </div>
        </div>

        <form className="editor-form" action={saveSiteSettingsAction}>
          <div className="editor-grid editor-grid--three">
            <label>
              <span>Site name</span>
              <input name="siteName" required defaultValue={settings.siteName} />
            </label>
            <label>
              <span>Donate button label</span>
              <input name="donateButtonLabel" defaultValue={settings.donateButtonLabel} />
            </label>
            <label>
              <span>Donate button URL</span>
              <input name="donateButtonUrl" defaultValue={settings.donateButtonUrl} />
            </label>
          </div>

          <div className="checkbox-grid">
            <label className="checkbox-row">
              <input name="showDonateButton" type="checkbox" defaultChecked={settings.showDonateButton} />
              <span>Show donate button</span>
            </label>
          </div>

          <label>
            <span>Footer text</span>
            <textarea name="footerText" rows={3} defaultValue={settings.footerText} />
          </label>

          <label>
            <span>Copyright text</span>
            <input name="copyrightText" defaultValue={settings.copyrightText} />
          </label>

          {NAVIGATION_GROUPS.map((group) => (
            <NavigationGroupEditor key={group.name} group={group} settings={settings} pages={pages} />
          ))}

          <div className="editor-form__actions">
            <button className="button button--ghost" type="submit" name="publicationAction" value="draft">Save draft</button>
            <button className="button" type="submit" name="publicationAction" value="publish">Publish</button>
            {settings.publicationStatus === "published" ? <button className="button button--ghost" type="submit" name="publicationAction" value="unpublish">Unpublish</button> : null}
            <Link className="button button--ghost" href="/content">Cancel</Link>
            <span className="muted-copy">Last updated {formatDate(settings.updatedAt)}</span>
          </div>
        </form>
      </section>
    </div>
  );
}
