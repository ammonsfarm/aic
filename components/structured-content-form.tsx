import { RichTextArea } from "@/app/(private)/content/strapi-pages/page-editor-client";
import type { StructuredEntry } from "@/lib/strapi-structured-management";
import type {
  StructuredCollectionDefinition,
  StructuredFieldDefinition,
} from "@/lib/structured-content-config";

function unwrappedMedia(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.data && typeof record.data === "object") {
    return unwrappedMedia(record.data);
  }
  if (record.attributes && typeof record.attributes === "object") {
    return { ...record.attributes as Record<string, unknown>, ...record };
  }
  return record;
}

function rawFieldValue(entry: StructuredEntry | null, field: StructuredFieldDefinition) {
  return entry?.[field.name];
}

function fieldString(entry: StructuredEntry | null, field: StructuredFieldDefinition) {
  const value = rawFieldValue(entry, field);
  if (Array.isArray(value)) {
    return value.map(String).join(", ");
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (field.type === "datetime") {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 16);
    }
  }
  return String(value);
}

function currentMedia(entry: StructuredEntry | null, field: StructuredFieldDefinition) {
  if (!field.mediaTarget || !entry) {
    return null;
  }
  return unwrappedMedia(entry[field.mediaTarget]);
}

function StandardField({
  entry,
  field,
  creating,
}: {
  entry: StructuredEntry | null;
  field: StructuredFieldDefinition;
  creating: boolean;
}) {
  const value = fieldString(entry, field);
  const helpId = `${field.name}-help`;

  if (field.type === "richtext") {
    return (
      <RichTextArea
        name={field.name}
        defaultValue={value}
        rows={14}
        helpText={field.help || `${field.label} content for the public site.`}
      />
    );
  }

  if (field.type === "checkbox") {
    const defaultChecked = Boolean(rawFieldValue(entry, field) ?? (creating && field.name === "active"));
    return (
      <label className="checkbox-row checkbox-row--form">
        <input name={field.name} type="checkbox" defaultChecked={defaultChecked} />
        <span>{field.label}</span>
      </label>
    );
  }

  if (field.type === "file") {
    const media = currentMedia(entry, field);
    const mediaName = typeof media?.name === "string" ? media.name : "";
    const mediaUrl = typeof media?.url === "string" ? media.url : "";
    return (
      <label>
        <span>{field.label}</span>
        <input
          name={field.name}
          type="file"
          accept={field.accept}
          required={Boolean(creating && field.required && !media)}
          aria-describedby={helpId}
        />
        <small id={helpId}>
          {mediaName ? `Current file: ${mediaName}` : field.help || "Leave empty to keep the current file."}
          {mediaUrl ? <> · <a href={mediaUrl}>Open current file</a></> : null}
        </small>
      </label>
    );
  }

  if (field.type === "textarea") {
    return (
      <label>
        <span>{field.label}</span>
        <textarea
          name={field.name}
          rows={5}
          required={field.required}
          defaultValue={value}
          aria-describedby={field.help ? helpId : undefined}
        />
        {field.help ? <small id={helpId}>{field.help}</small> : null}
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label>
        <span>{field.label}</span>
        <select
          name={field.name}
          required={field.required}
          defaultValue={value || field.options?.[0] || ""}
          aria-describedby={field.help ? helpId : undefined}
        >
          {!field.required ? <option value="">Not set</option> : null}
          {(field.options || []).map((option) => (
            <option key={option} value={option}>
              {option.replace(/-/g, " ")}
            </option>
          ))}
        </select>
        {field.help ? <small id={helpId}>{field.help}</small> : null}
      </label>
    );
  }

  const type =
    field.type === "number"
      ? "number"
      : field.type === "date"
        ? "date"
        : field.type === "datetime"
          ? "datetime-local"
          : field.type === "email"
            ? "email"
            : field.type === "url"
              ? "text"
              : "text";

  return (
    <label>
      <span>{field.label}</span>
      <input
        name={field.name}
        type={type}
        required={field.required}
        defaultValue={value}
        aria-describedby={field.help ? helpId : undefined}
      />
      {field.help ? <small id={helpId}>{field.help}</small> : null}
    </label>
  );
}

export function StructuredContentForm({
  definition,
  entry,
  action,
}: {
  definition: StructuredCollectionDefinition;
  entry: StructuredEntry | null;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const creating = !entry;

  return (
    <form className="editor-form" action={action}>
      <div className="editor-grid editor-grid--two">
        {definition.fields.map((field) => (
          <StandardField key={field.name} entry={entry} field={field} creating={creating} />
        ))}
      </div>

      <label>
        <span>Change note</span>
        <input
          name="changeNote"
          placeholder={creating ? "Why is this item being created?" : "What changed in this revision?"}
        />
        <small>Saved with the revision and audit attribution.</small>
      </label>

      <div className="editor-form__actions">
        <button className="button" type="submit">
          {creating ? `Create ${definition.singularLabel}` : "Save draft revision"}
        </button>
      </div>
    </form>
  );
}
