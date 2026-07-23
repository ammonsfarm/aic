import Link from "next/link";
import { notFound } from "next/navigation";

import { StructuredContentForm } from "@/components/structured-content-form";
import { getStructuredCollection } from "@/lib/structured-content-config";
import { listReusableMediaOptions, listStructuredPeopleOptions } from "@/lib/strapi-structured-management";
import { createStructuredEntryAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewStructuredEntryPage({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const { collection } = await params;
  const definition = getStructuredCollection(collection);
  if (!definition) {
    notFound();
  }

  const action = createStructuredEntryAction.bind(null, definition.key);
  const relationOptions = definition.fields.some((field) => field.relationTarget === "people")
    ? await listStructuredPeopleOptions()
    : [];
  let mediaOptions: Awaited<ReturnType<typeof listReusableMediaOptions>> = [];
  if (definition.key !== "media-assets" && definition.fields.some((field) => field.type === "file")) {
    try {
      mediaOptions = await listReusableMediaOptions();
    } catch (cause) {
      console.error("Reusable media lookup failed", cause);
    }
  }

  return (
    <div className="stack">
      <section className="signal-board">
        <div>
          <p className="eyebrow">Content / {definition.pluralLabel}</p>
          <h1>New {definition.singularLabel}</h1>
          <p>Create a private draft first. Publishing is a separate, explicit action.</p>
        </div>
        <div className="button-row">
          <Link className="button button--ghost" href={definition.editorPath}>Cancel</Link>
        </div>
      </section>

      <section className="data-card">
        <div className="data-card__header">
          <div>
            <p className="eyebrow">Draft</p>
            <h2>Content details</h2>
          </div>
        </div>
        <StructuredContentForm definition={definition} entry={null} action={action} relationOptions={relationOptions} mediaOptions={mediaOptions} />
      </section>
    </div>
  );
}
