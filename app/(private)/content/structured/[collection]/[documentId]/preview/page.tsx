import Link from "next/link";
import { notFound } from "next/navigation";

import { PastorWoodShell } from "@/components/pastor-wood-site";
import { safeCmsHref, sanitizeCmsHtml } from "@/lib/cms-html";
import { getStructuredEntry } from "@/lib/strapi-structured-management";
import {
  getStructuredCollection,
  type StructuredCollectionKey,
  type StructuredFieldDefinition,
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

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.map(mediaRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  }
  const record = mediaRecord(value);
  if (Array.isArray(record?.data)) {
    return record.data.map(mediaRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  }
  if (record?.data) {
    const item = mediaRecord(record.data);
    return item ? [item] : [];
  }
  return record ? [record] : [];
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

function PreviewField({ field, value }: { field: StructuredFieldDefinition; value: unknown }) {
  if (field.type === "richtext") {
    return <div className="pw-rich-text" dangerouslySetInnerHTML={{ __html: sanitizeCmsHtml(display(value)) }} />;
  }
  if (field.type === "file") {
    const media = mediaRecord(value);
    if (!media) return <p>—</p>;
    const name = display(media.name || media.alternativeText || "Attached media");
    const href = previewMediaHref(media.url);
    const mime = typeof media.mime === "string" ? media.mime.toLowerCase() : "";
    const accept = field.accept?.toLowerCase() || "";
    const isImage = (mime.startsWith("image/") || accept.startsWith("image/")) && !mime.includes("svg");
    const isAudio = mime.startsWith("audio/") || accept.startsWith("audio/");
    const isVideo = mime.startsWith("video/") || accept.startsWith("video/");
    if (href && isImage) {
      const alt = display(media.alternativeText || media.caption || field.label);
      return (
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={href} alt={alt === "—" ? "" : alt} style={{ display: "block", height: "auto", maxWidth: "min(100%, 48rem)" }} />
          <figcaption>{name}</figcaption>
        </figure>
      );
    }
    if (href && isAudio) {
      return <div className="pw-audio-card"><audio controls preload="metadata" src={href}>Your browser cannot play this audio.</audio><a href={href}>{name}</a></div>;
    }
    if (href && isVideo) {
      return <div><video controls preload="metadata" src={href} style={{ display: "block", maxWidth: "min(100%, 48rem)" }}>Your browser cannot play this video.</video><a href={href}>{name}</a></div>;
    }
    return href ? <p><a href={href}>{name}</a></p> : <p>{name}</p>;
  }
  if (field.type === "url") {
    const href = safeCmsHref(display(value));
    return href ? <p><a href={href}>{href}</a></p> : <p>—</p>;
  }
  if (field.type === "relation") {
    const related = records(value);
    return related.length ? (
      <ul>{related.map((item) => (
        <li key={String(item.documentId || item.id || item.name)}>{display(item.name || item.title || item.attribution || item.documentId)}</li>
      ))}</ul>
    ) : <p>—</p>;
  }
  if (field.type === "scripture") {
    const references = records(value);
    return references.length ? (
      <ul>{references.map((reference, index) => {
        const href = safeCmsHref(display(reference.url));
        const label = display(reference.label);
        return <li key={String(reference.id || `${label}-${index}`)}>{href ? <a href={href}>{label}</a> : label}</li>;
      })}</ul>
    ) : <p>—</p>;
  }
  if (field.type === "external-links") {
    const links = records(value);
    return links.length ? (
      <ul>{links.map((link, index) => {
        const href = safeCmsHref(display(link.url));
        const label = display(link.label);
        return <li key={String(link.id || `${label}-${index}`)}>{href ? <a href={href}>{label}</a> : label}{link.description ? ` — ${display(link.description)}` : ""}</li>;
      })}</ul>
    ) : <p>—</p>;
  }
  if (field.type === "seo") {
    const seo = mediaRecord(value);
    if (!seo) return <p>—</p>;
    return (
      <dl>
        <dt>Search title</dt><dd>{display(seo.title)}</dd>
        <dt>Description</dt><dd>{display(seo.description)}</dd>
        <dt>Canonical URL</dt><dd>{display(seo.canonicalUrl)}</dd>
        <dt>Hidden from search engines</dt><dd>{seo.noIndex ? "Yes" : "No"}</dd>
      </dl>
    );
  }
  return <p style={{ whiteSpace: "pre-wrap" }}>{display(value)}</p>;
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
      <article className="pw-section pw-writing-detail">
        <p className="pw-eyebrow">{definition.pluralLabel}</p>
        <h1>{display(entry[definition.titleField])}</h1>
        {definition.fields.map((field) => {
          const value = field.type === "file" && field.mediaTarget ? entry[field.mediaTarget] : entry[field.name];
          if (field.name === definition.titleField || value === null || value === undefined || value === "") return null;
          return (
            <section className="pw-preview-field" key={field.name}>
              <h2>{field.label}</h2>
              <PreviewField field={field} value={value} />
            </section>
          );
        })}
      </article>
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
