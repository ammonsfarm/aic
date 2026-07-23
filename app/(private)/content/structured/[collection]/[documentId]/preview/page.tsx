import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHero, PastorWoodShell } from "@/components/pastor-wood-site";
import { safeCmsHref, sanitizeCmsHtml } from "@/lib/cms-html";
import { getStructuredEntry, type StructuredEntry } from "@/lib/strapi-structured-management";
import {
  getStructuredCollection,
  type StructuredCollectionKey,
} from "@/lib/structured-content-config";

export const dynamic = "force-dynamic";

function display(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function mediaRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.data && typeof record.data === "object") return mediaRecord(record.data);
  if (record.attributes && typeof record.attributes === "object") {
    return { ...(record.attributes as Record<string, unknown>), ...record };
  }
  return record;
}

function previewMediaHref(value: unknown) {
  const rawUrl = typeof value === "string" ? value.trim() : "";
  if (!rawUrl || rawUrl.startsWith("//")) return "";

  try {
    const absolute = /^https?:\/\//i.test(rawUrl);
    const parsed = new URL(rawUrl, "https://strapi-preview.invalid");
    const configuredBase = process.env.STRAPI_MANAGEMENT_URL?.trim() || process.env.STRAPI_URL?.trim() || "";
    const isConfiguredStrapi = !absolute || (configuredBase && parsed.origin === new URL(configuredBase).origin);
    if (isConfiguredStrapi && parsed.pathname.startsWith("/uploads/")) {
      const encodedPath = parsed.pathname
        .slice("/uploads/".length)
        .split("/")
        .filter(Boolean)
        .map((part) => encodeURIComponent(decodeURIComponent(part)))
        .join("/");
      return encodedPath ? `/api/content/strapi-media/${encodedPath}` : "";
    }
  } catch {
    return "";
  }

  const safe = safeCmsHref(rawUrl);
  return /^https?:\/\//i.test(safe) ? safe : "";
}

function entryText(entry: StructuredEntry, field: string) {
  const value = entry[field];
  return value === null || value === undefined ? "" : String(value);
}

function entryMedia(entry: StructuredEntry, field: string) {
  const media = mediaRecord(entry[field]);
  if (!media) return null;
  const href = previewMediaHref(media.url);
  if (!href) return null;
  return {
    href,
    name: display(media.name || media.alternativeText || "Attached media"),
    alt: display(media.alternativeText || media.caption || ""),
    caption: typeof media.caption === "string" ? media.caption : "",
    mime: typeof media.mime === "string" ? media.mime.toLowerCase() : "",
  };
}

function plainText(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function formatDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function PostPreview({ entry }: { entry: StructuredEntry }) {
  const title = entryText(entry, "title") || "Untitled writing";
  const summary = entryText(entry, "summary");
  const contentType = entryText(entry, "contentType").replace(/-/g, " ") || "Written Resources";
  const image = entryMedia(entry, "featuredImage");
  return (
    <>
      <PageHero eyebrow={contentType} title={title} body={summary} />
      <article className="pw-section pw-writing-detail">
        {image ? (
          <figure className="pw-structured-featured-image">
            <img src={image.href} alt={image.alt === "—" ? "" : image.alt} />
            {image.caption ? <figcaption>{image.caption}</figcaption> : null}
          </figure>
        ) : null}
        <p className="pw-kicker">{formatDate(entryText(entry, "publishDate"))}</p>
        <div className="pw-rich-text" dangerouslySetInnerHTML={{ __html: sanitizeCmsHtml(entryText(entry, "body")) }} />
      </article>
    </>
  );
}

function EpisodePreview({ entry }: { entry: StructuredEntry }) {
  const title = entryText(entry, "title") || "Untitled broadcast";
  const summary = entryText(entry, "summary");
  const audio = entryMedia(entry, "audio");
  const externalAudio = safeCmsHref(entryText(entry, "externalAudioUrl"));
  const audioHref = audio?.href || (/^https:\/\//i.test(externalAudio) ? externalAudio : "");
  return (
    <>
      <PageHero eyebrow="Radio Archive" title={title} body={summary || "Listen to this Abiding in Christ broadcast."} />
      <section className="pw-section">
        <div className="pw-audio-list">
          <article className="pw-audio-card">
            <div className="pw-audio-card__meta">
              {entryText(entry, "programDate") ? <span>{entryText(entry, "programDate")}</span> : null}
              {entryText(entry, "trackId") ? <span>{entryText(entry, "trackId")}</span> : null}
            </div>
            <h2>{title}</h2>
            {summary ? <p>{summary}</p> : null}
            {audioHref ? <audio controls preload="none" src={audioHref}>Your browser cannot play this audio.</audio> : <p>Audio is not attached to this draft.</p>}
          </article>
        </div>
      </section>
    </>
  );
}

function PersonPreview({ entry }: { entry: StructuredEntry }) {
  const name = entryText(entry, "name") || "Unnamed person";
  const photo = entryMedia(entry, "photo");
  return (
    <>
      <PageHero eyebrow="Board" title="Abiding in Christ Board Members" body="Previewing this person in the public board layout." />
      <section className="pw-section">
        <div className="pw-board-grid">
          <article className="pw-board-member">
            {photo ? <img src={photo.href} alt={name} /> : null}
            <div>
              <h2>{name}</h2>
              <p className="pw-board-role">{entryText(entry, "title") || entryText(entry, "organization")}</p>
              {entryText(entry, "biography") ? <p>{plainText(entryText(entry, "biography"))}</p> : null}
            </div>
          </article>
        </div>
      </section>
    </>
  );
}

function EndorsementPreview({ entry }: { entry: StructuredEntry }) {
  const photo = entryMedia(entry, "photo");
  return (
    <>
      <PageHero eyebrow="Endorsements" title="Endorsements for Pastor Wood" body="Previewing this quote in the public endorsements layout." />
      <section className="pw-section">
        <div className="pw-endorsement-grid">
          <figure className="pw-endorsement">
            <blockquote>“{entryText(entry, "quote")}”</blockquote>
            <figcaption>
              {photo ? <img src={photo.href} alt="" /> : null}
              <span>
                <strong>{entryText(entry, "attribution") || "Missing attribution"}</strong>
                {[entryText(entry, "title"), entryText(entry, "organization")].filter(Boolean).join(", ")}
              </span>
            </figcaption>
          </figure>
        </div>
      </section>
    </>
  );
}

function MediaAssetPreview({ entry }: { entry: StructuredEntry }) {
  const asset = entryMedia(entry, "asset");
  const title = entryText(entry, "title") || "Untitled media";
  const type = entryText(entry, "assetType");
  return (
    <>
      <PageHero eyebrow="Media Library" title={title} body={entryText(entry, "caption") || "Reusable public media preview."} />
      <section className="pw-section pw-writing-detail">
        {!asset ? <p>No file is attached to this draft.</p> : type === "image" || asset.mime.startsWith("image/") ? (
          <figure><img src={asset.href} alt={entryText(entry, "altText")} /><figcaption>{entryText(entry, "caption")}</figcaption></figure>
        ) : type === "audio" || asset.mime.startsWith("audio/") ? (
          <div className="pw-audio-card"><audio controls preload="metadata" src={asset.href}>Your browser cannot play this audio.</audio></div>
        ) : type === "video" || asset.mime.startsWith("video/") ? (
          <video controls preload="metadata" src={asset.href}>Your browser cannot play this video.</video>
        ) : <a className="pw-button pw-button--primary" href={asset.href}>Open {title}</a>}
        {entryText(entry, "credit") ? <p>Credit: {entryText(entry, "credit")}</p> : null}
      </section>
    </>
  );
}

function RedirectPreview({ entry }: { entry: StructuredEntry }) {
  const fromPath = entryText(entry, "fromPath");
  const toPath = safeCmsHref(entryText(entry, "toPath"));
  return (
    <>
      <PageHero eyebrow="Legacy Redirect" title={fromPath || "Missing source path"} body="This rule has no visual public page. The preview shows its visitor-facing routing behavior." />
      <section className="pw-section pw-content-unavailable">
        <h2>{entryText(entry, "statusCode") || "Redirect"}</h2>
        <p><code>{fromPath || "—"}</code> redirects visitors to {toPath ? <a href={toPath}><code>{toPath}</code></a> : <strong>an invalid destination</strong>}.</p>
      </section>
    </>
  );
}

function PublicLayoutPreview({ collection, entry }: { collection: StructuredCollectionKey; entry: StructuredEntry }) {
  if (collection === "posts") return <PostPreview entry={entry} />;
  if (collection === "episodes") return <EpisodePreview entry={entry} />;
  if (collection === "people") return <PersonPreview entry={entry} />;
  if (collection === "endorsements") return <EndorsementPreview entry={entry} />;
  if (collection === "media-assets") return <MediaAssetPreview entry={entry} />;
  return <RedirectPreview entry={entry} />;
}

export async function StructuredEntryPreviewView({
  collection,
  documentId,
}: {
  collection: StructuredCollectionKey;
  documentId: string;
}) {
  const definition = getStructuredCollection(collection);
  if (!definition) notFound();
  const entry = await getStructuredEntry(definition.key, documentId);
  if (!entry) notFound();

  return (
    <PastorWoodShell contentElement="div">
      <aside className="notice-card" role="status">
        <strong>Private draft preview</strong>
        <p>This uses the public HTML sanitizer and content typography. It is never a public URL.</p>
        <Link className="button button--ghost" href={`${definition.editorPath}/${documentId}`}>Back to editor</Link>
      </aside>
      <PublicLayoutPreview collection={definition.key} entry={entry} />
    </PastorWoodShell>
  );
}

export default async function StructuredEntryPreviewPage({
  params,
}: {
  params: Promise<{ collection: string; documentId: string }>;
}) {
  const { collection, documentId } = await params;
  const definition = getStructuredCollection(collection);
  if (!definition) notFound();
  return StructuredEntryPreviewView({
    collection: definition.key,
    documentId: decodeURIComponent(documentId),
  });
}
