import Link from "next/link";

import type { ManagedStrapiPage } from "@/lib/strapi-management";
import {
  publicSubscriptionCaptureEnabled,
  subscriptionProviderConfigReady,
} from "@/lib/subscription-provider-config";
import {
  getManagedSiteSettings,
  listManagedSiteSettingsRevisions,
  listSiteSettingsPageOptions,
  type ManagedNavigationItem,
  type ManagedSiteSettings,
  type ManagedSiteSettingsRevision,
} from "@/lib/strapi-site-settings-management";
import {
  initializeSiteSettingsAction,
  rollbackSiteSettingsAction,
  saveSiteSettingsAction,
} from "./actions";

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
              <option key={page.documentId} value={page.documentId}>
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
              <option key={page.documentId} value={page.documentId}>
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
    let revisions: ManagedSiteSettingsRevision[] = [];
    let revisionsError = "";
    if (settings) {
      try {
        revisions = await listManagedSiteSettingsRevisions(settings.documentId);
      } catch (error) {
        console.error("Site settings revision lookup failed", error);
        revisionsError = error instanceof Error ? error.message : "Revision history could not be loaded.";
      }
    }
    return { settings, pages, revisions, revisionsError, error: null as string | null };
  } catch (error) {
    console.error("Site settings lookup failed", error);
    return {
      settings: null,
      pages: [] as ManagedStrapiPage[],
      revisions: [] as ManagedSiteSettingsRevision[],
      revisionsError: "",
      error: error instanceof Error ? error.message : "Site settings could not be loaded.",
    };
  }
}

export default async function SiteSettingsPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  const { settings, pages, revisions, revisionsError, error } = await getEditorData();

  if (!settings) {
    return (
      <div className="stack">
        <section className="notice-card">
          <strong>{error ? "Could not load site settings" : "Initialize site settings"}</strong>
          <p>{error ?? "Create the first revisioned settings record before editing global navigation, branding, and subscriptions."}</p>
          {!error ? (
            <form action={initializeSiteSettingsAction}>
              <button className="button" type="submit">Initialize site settings</button>
            </form>
          ) : null}
          <Link className="button button--ghost" href="/content">Back to content portal</Link>
        </section>
      </div>
    );
  }

  const navigationCount =
    settings.topNavigation.length + settings.utilityNavigation.length + settings.footerNavigation.length;
  const subscriptionProviderReady = subscriptionProviderConfigReady();
  const subscriptionRuntimeReady = publicSubscriptionCaptureEnabled();

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
            Donate button
          </span>
          <span>
            <strong>{settings.publicationStatus === "published" ? "Published" : "Draft only"}</strong>
            Publish state
          </span>
        </div>
      </section>

      {state ? (
        <section className="notice-card notice-card--success" role="status">
          <strong>{state === "published" ? "Published" : state === "unpublished" ? "Unpublished" : state === "rolled-back" ? "Revision restored" : state === "initialized" ? "Initialized" : "Draft saved"}</strong>
          <p>
            {state === "published"
              ? "The latest site settings are now public."
              : state === "unpublished"
                ? "The public settings were removed; the draft remains available."
                : state === "rolled-back"
                  ? "The selected revision is now the current draft. Review it before publishing."
                  : state === "initialized"
                    ? "The first audited site-settings draft is ready to edit."
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
          <input type="hidden" name="expectedUpdatedAt" value={settings.updatedAt} />
          <div className="editor-grid editor-grid--two">
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
              <input name="donateButtonUrl" type="url" defaultValue={settings.donateButtonUrl} />
              <small>Use an explicitly allowlisted external HTTPS giving provider. Leave blank to keep public giving unavailable.</small>
            </label>
            <label>
              <span>Donor dashboard URL</span>
              <input name="donorDashboardUrl" type="url" defaultValue={settings.donorDashboardUrl} />
              <small>Use a separately allowlisted external HTTPS account provider. Leave blank when unavailable.</small>
            </label>
          </div>

          <fieldset className="section-editor">
            <legend>Header logo</legend>
            {settings.headerLogo?.previewUrl ? (
              <div className="media-preview-row">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={settings.headerLogo.previewUrl}
                  alt={settings.headerLogo.alternativeText || "Current header logo preview"}
                />
                <p className="muted-copy">
                  Current file: <strong>{settings.headerLogo.name || "Header logo"}</strong>. Upload a replacement only when the public wordmark should change.
                </p>
              </div>
            ) : <p className="muted-copy">The built-in Abiding in Christ wordmark is currently used.</p>}
            <div className="editor-grid editor-grid--two">
              <label>
                <span>{settings.headerLogo ? "Replace logo" : "Upload logo"}</span>
                <input name="headerLogoFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" />
                <small>JPEG, PNG, WebP, GIF, or AVIF; 15 MB maximum. Leave blank to keep the current logo.</small>
              </label>
              {settings.headerLogo ? (
                <label className="checkbox-row checkbox-row--form">
                  <input name="removeHeaderLogo" type="checkbox" />
                  <span>Remove custom logo and use the built-in wordmark</span>
                </label>
              ) : null}
            </div>
          </fieldset>

          <div className="checkbox-grid">
            <label className="checkbox-row">
              <input name="showDonateButton" type="checkbox" defaultChecked={settings.showDonateButton} />
              <span>Show donate button</span>
            </label>
            <label className="checkbox-row">
              <input name="subscriptionEnabled" type="checkbox" defaultChecked={settings.subscriptionEnabled} />
              <span>Request weekly devotional subscription forms</span>
            </label>
          </div>
          <p className="muted-copy">
            Publishing this request does not override protected operations controls. Forms are effective only when provider configuration is {subscriptionProviderReady ? "ready" : "incomplete"} and the runtime gate is {subscriptionRuntimeReady ? "enabled" : "disabled"}.
          </p>

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

          <label>
            <span>Change note</span>
            <input name="changeNote" maxLength={1000} placeholder="Optional reason for this revision" />
            <small>Saved with the immutable revision and audit history.</small>
          </label>

          <div className="editor-form__actions">
            <button className="button button--ghost" type="submit" name="publicationAction" value="draft">Save draft</button>
            <button className="button" type="submit" name="publicationAction" value="publish">Publish</button>
            {settings.publicationStatus === "published" ? <button className="button button--ghost" type="submit" name="publicationAction" value="unpublish">Unpublish</button> : null}
            <Link className="button button--ghost" href="/content">Cancel</Link>
            <span className="muted-copy">Last updated {formatDate(settings.updatedAt)}</span>
          </div>
        </form>
      </section>

      <section className="data-card">
        <div className="data-card__header">
          <div><p className="eyebrow">Revision history</p><h2>Audit trail and rollback</h2></div>
          <span className="status-pill">{revisions.length} revisions</span>
        </div>
        {revisionsError ? (
          <div className="editor-form"><p role="alert">{revisionsError}</p></div>
        ) : (
          <div className="responsive-table" role="region" aria-label="Site settings revision history">
            <table>
              <thead><tr><th>Revision</th><th>Action</th><th>Editor</th><th>Note</th><th>Created</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {revisions.map((revision) => (
                  <tr key={revision.documentId}>
                    <td>#{revision.revisionNumber}</td>
                    <td>{revision.action}</td>
                    <td>{revision.actorName || revision.actorEmail}</td>
                    <td>{revision.note || "—"}</td>
                    <td>{formatDate(revision.createdAt)}</td>
                    <td>
                      <form action={rollbackSiteSettingsAction.bind(null, settings.documentId, revision.documentId)}>
                        <input type="hidden" name="rollbackNote" value={`Restore site settings revision ${revision.revisionNumber}.`} />
                        <input type="hidden" name="expectedUpdatedAt" value={settings.updatedAt} />
                        <button className="button button--ghost" type="submit">Restore as draft</button>
                      </form>
                    </td>
                  </tr>
                ))}
                {!revisions.length ? <tr><td colSpan={6}><span className="muted-copy">No revision records yet.</span></td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
