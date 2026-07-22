import Link from "next/link";
import { notFound } from "next/navigation";

import { getStructuredEntry } from "@/lib/strapi-structured-management";
import { getStructuredCollection, type StructuredCollectionKey } from "@/lib/structured-content-config";

export const dynamic = "force-dynamic";

function display(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
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
    <div className="stack">
      <section className="signal-board">
        <div>
          <p className="eyebrow">Private draft preview</p>
          <h1>{display(entry[definition.titleField])}</h1>
          <p>This protected preview shows the current draft values. It is never used as a public URL.</p>
        </div>
        <div className="button-row">
          <Link className="button button--ghost" href={`${definition.editorPath}/${documentId}`}>Back to editor</Link>
        </div>
      </section>

      <section className="data-card">
        <div className="data-card__header">
          <div><p className="eyebrow">{definition.pluralLabel}</p><h2>Draft content</h2></div>
        </div>
        <div className="editor-form">
          {definition.fields.filter((field) => field.type !== "file").map((field) => (
            <article className="notice-card" key={field.name}>
              <strong>{field.label}</strong>
              <p style={{ whiteSpace: "pre-wrap" }}>{display(entry[field.name])}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
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
