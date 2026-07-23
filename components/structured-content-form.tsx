"use client";

import { useEffect, useRef, useState } from "react";

import { RichTextArea } from "@/app/(private)/content/strapi-pages/page-editor-client";
import type { ReusableMediaOption, StructuredEntry, StructuredRelationOption } from "@/lib/strapi-structured-management";
import type {
  StructuredCollectionDefinition,
  StructuredFieldDefinition,
} from "@/lib/structured-content-config";
import { isSiblingEditorForm } from "@/lib/unsaved-editor-guard";

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

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.attributes && typeof record.attributes === "object") {
    return { ...(record.attributes as Record<string, unknown>), ...record };
  }
  return record;
}

function arrayValue(value: unknown) {
  if (Array.isArray(value)) return value;
  const record = recordValue(value);
  return Array.isArray(record?.data) ? record.data : [];
}

function relationSelections(value: unknown): StructuredRelationOption[] {
  const record = recordValue(value);
  const candidates = Array.isArray(value)
    ? value
    : Array.isArray(record?.data)
      ? record.data
      : record?.data
        ? [record.data]
        : value
          ? [value]
          : [];
  return candidates.flatMap((candidate) => {
    const item = recordValue(candidate);
    const documentId = typeof item?.documentId === "string" ? item.documentId : "";
    if (!documentId) return [];
    const label = String(item?.name || item?.title || item?.attribution || documentId);
    return [{ documentId, label }];
  });
}

function scriptureValue(value: unknown) {
  return arrayValue(value).flatMap((candidate) => {
    const item = recordValue(candidate);
    if (!item) return [];
    return [[
      item.label,
      item.book,
      item.chapter,
      item.verseStart,
      item.verseEnd,
      item.translation,
      item.url,
    ].map((part) => String(part ?? "").replace(/\|/g, "-")).join(" | ")];
  }).join("\n");
}

function externalLinksValue(value: unknown) {
  return arrayValue(value).flatMap((candidate) => {
    const item = recordValue(candidate);
    if (!item) return [];
    return [[item.label, item.url, item.description]
      .map((part) => String(part ?? "").replace(/\|/g, "-"))
      .join(" | ")];
  }).join("\n");
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
  relationOptions,
  mediaOptions,
}: {
  entry: StructuredEntry | null;
  field: StructuredFieldDefinition;
  creating: boolean;
  relationOptions: StructuredRelationOption[];
  mediaOptions: ReusableMediaOption[];
}) {
  const value = fieldString(entry, field);
  const helpId = `${field.name}-help`;

  if (field.type === "relation") {
    const selected = relationSelections(rawFieldValue(entry, field));
    const options = [...relationOptions];
    for (const current of selected) {
      if (!options.some((option) => option.documentId === current.documentId)) options.push(current);
    }
    const selectedIds = selected.map((option) => option.documentId);
    return (
      <label>
        <span>{field.label}</span>
        <select
          name={field.name}
          multiple={field.multiple}
          size={field.multiple ? Math.min(8, Math.max(4, options.length)) : undefined}
          required={field.required}
          defaultValue={field.multiple ? selectedIds : selectedIds[0] || ""}
          aria-describedby={helpId}
        >
          {!field.multiple && !field.required ? <option value="">Not set</option> : null}
          {options.map((option) => (
            <option key={option.documentId} value={option.documentId}>{option.label}</option>
          ))}
        </select>
        <small id={helpId}>
          {field.multiple ? "Use Command or Control to select more than one person." : "Choose a person already managed in People and board."}
        </small>
      </label>
    );
  }

  if (field.type === "scripture") {
    return (
      <label>
        <span>{field.label}</span>
        <textarea name={field.name} rows={6} defaultValue={scriptureValue(rawFieldValue(entry, field))} aria-describedby={helpId} />
        <small id={helpId}>{field.help}</small>
      </label>
    );
  }

  if (field.type === "external-links") {
    return (
      <label>
        <span>{field.label}</span>
        <textarea name={field.name} rows={5} defaultValue={externalLinksValue(rawFieldValue(entry, field))} aria-describedby={helpId} />
        <small id={helpId}>{field.help}</small>
      </label>
    );
  }

  if (field.type === "seo") {
    const seo = recordValue(rawFieldValue(entry, field)) || {};
    const socialImage = unwrappedMedia(seo.socialImage);
    const socialImageName = typeof socialImage?.name === "string" ? socialImage.name : "";
    const socialImageUrl = typeof socialImage?.url === "string" ? socialImage.url : "";
    return (
      <fieldset className="editor-field-group">
        <legend>{field.label}</legend>
        <label>
          <span>Search title</span>
          <input name={`${field.name}.title`} maxLength={70} defaultValue={String(seo.title || "")} />
        </label>
        <label>
          <span>Search description</span>
          <textarea name={`${field.name}.description`} maxLength={180} rows={3} defaultValue={String(seo.description || "")} />
        </label>
        <label>
          <span>Canonical URL</span>
          <input name={`${field.name}.canonicalUrl`} type="text" defaultValue={String(seo.canonicalUrl || "")} />
        </label>
        <label className="checkbox-row checkbox-row--form">
          <input name={`${field.name}.noIndex`} type="checkbox" defaultChecked={Boolean(seo.noIndex)} />
          <span>Hide from search engines</span>
        </label>
        <label>
          <span>Social sharing image</span>
          <input name={`${field.name}.socialImageFile`} type="file" accept="image/*" />
          <small>
            {socialImageName
              ? `Current image: ${socialImageName}. Leave empty to preserve it.`
              : "Choose an image for social sharing, or leave empty to use the site default."}
            {socialImageUrl ? <> · <a href={socialImageUrl}>Open current image</a></> : null}
          </small>
        </label>
      </fieldset>
    );
  }

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
    const compatibleOptions = mediaOptions.filter((option) => {
      if (field.accept?.includes("image/")) return option.assetType === "image" || option.mime.startsWith("image/");
      if (field.accept?.includes("audio/") || field.accept?.includes(".mp3")) return option.assetType === "audio" || option.mime.startsWith("audio/");
      return true;
    });
    return (
      <fieldset className="editor-field-group">
        <legend>{field.label}</legend>
        <label>
          <span>Use existing public media</span>
          <select name={`${field.name}LibraryId`} defaultValue="" aria-describedby={helpId}>
            <option value="">{media ? "Keep current file" : "Do not select an existing file"}</option>
            {compatibleOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Or upload a new file</span>
          <input name={field.name} type="file" accept={field.accept} aria-describedby={helpId} />
        </label>
        <small id={helpId}>
          {mediaName ? `Current file: ${mediaName}. ` : ""}
          {field.help || (creating && field.required ? "Choose an existing item or upload a file." : "Leave both controls empty to keep the current file.")}
          {mediaUrl ? <> · <a href={mediaUrl}>Open current file</a></> : null}
        </small>
      </fieldset>
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
  relationOptions = [],
  mediaOptions = [],
}: {
  definition: StructuredCollectionDefinition;
  entry: StructuredEntry | null;
  action: (formData: FormData) => void | Promise<void>;
  relationOptions?: StructuredRelationOption[];
  mediaOptions?: ReusableMediaOption[];
}) {
  const creating = !entry;
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty || submitting.current) return;
      event.preventDefault();
    }

    function confirmNavigation(event: MouseEvent) {
      if (!dirty || submitting.current || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement) || target.target === "_blank" || target.hasAttribute("download")) return;
      const destination = new URL(target.href, window.location.href);
      if (destination.href === window.location.href || destination.hash && destination.pathname === window.location.pathname) return;
      if (!window.confirm("You have unsaved changes. Leave this editor and discard them?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    function confirmSiblingSubmission(event: SubmitEvent) {
      if (!dirty || submitting.current || event.defaultPrevented) return;
      if (!isSiblingEditorForm(event.target, formRef.current)) return;
      if (!window.confirm("You have unsaved changes. Continue and discard them?")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }
      submitting.current = true;
      setDirty(false);
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", confirmNavigation, true);
    document.addEventListener("submit", confirmSiblingSubmission, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", confirmNavigation, true);
      document.removeEventListener("submit", confirmSiblingSubmission, true);
    };
  }, [dirty]);

  return (
    <form
      ref={formRef}
      className="editor-form"
      action={action}
      onInput={() => setDirty(true)}
      onChange={() => setDirty(true)}
      onSubmit={() => {
        submitting.current = true;
        setDirty(false);
      }}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {dirty ? "Unsaved changes. Save before leaving this editor." : ""}
      </p>
      {entry?.updatedAt ? (
        <input type="hidden" name="expectedUpdatedAt" value={entry.updatedAt} />
      ) : null}
      <div className="editor-grid editor-grid--two">
        {definition.fields.map((field) => (
          <StandardField
            key={field.name}
            entry={entry}
            field={field}
            creating={creating}
            relationOptions={relationOptions}
            mediaOptions={mediaOptions}
          />
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
