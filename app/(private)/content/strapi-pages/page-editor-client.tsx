"use client";

import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { isSiblingEditorForm } from "@/lib/unsaved-editor-guard";

type PageCoreFieldsProps = {
  initialTitle?: string;
  initialSlug?: string;
  initialPageKey?: string;
  existingSlugs: string[];
};

type RichTextAreaProps = {
  name: string;
  defaultValue?: string;
  rows?: number;
  helpText?: string;
};

type PageEditorFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
};

type AddSectionFieldsProps = {
  existingSectionCount: number;
};

type ExistingSectionBodyProps = {
  prefix: string;
  component: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string;
  imageSide: "none" | "left" | "right" | "";
  imageDescription: string;
  imageName: string;
  imageUrl?: string;
  imageAlt?: string;
};

const SECTION_OPTIONS = [
  {
    value: "page-sections.text-section",
    label: "Text",
    description: "Use this for normal page copy.",
  },
  {
    value: "page-sections.image-text-section",
    label: "Image + Text",
    description: "Use this for a photo beside page copy.",
  },
  {
    value: "page-sections.cta-section",
    label: "Call to Action",
    description: "Use this for a short message with a button.",
  },
] as const;

type SectionComponent = (typeof SECTION_OPTIONS)[number]["value"];

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 20 * 1024 * 1024;

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatBytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applyInlineMarkdown(value: string): string {
  const pattern = /(\*\*([\s\S]+?)\*\*)|(\*(?!\*)([\s\S]+?)\*)|(\[u\]([\s\S]+?)\[\/u\])|(<u>([\s\S]+?)<\/u>)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let html = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      html += escapeHtml(value.slice(lastIndex, match.index));
    }

    if (match[2]) {
      html += `<strong>${applyInlineMarkdown(match[2])}</strong>`;
    } else if (match[4]) {
      html += `<em>${applyInlineMarkdown(match[4])}</em>`;
    } else if (match[6]) {
      html += `<u>${applyInlineMarkdown(match[6].replace(/^>\s*/, ""))}</u>`;
    } else if (match[8]) {
      html += `<u>${applyInlineMarkdown(match[8].replace(/^>\s*/, ""))}</u>`;
    } else if (match[10] && match[11]) {
      html += `<a href="${escapeHtml(match[11])}">${escapeHtml(match[10])}</a>`;
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) {
    html += escapeHtml(value.slice(lastIndex));
  }

  return html;
}

function parseAlignment(value: string) {
  const match = value.match(/^\[align:(left|center|right)\](.*)\[\/align\]$/);
  return match ? { align: match[1], text: match[2].trim() } : { align: "", text: value };
}

function markdownToHtml(value: string) {
  if (/<[a-z][\s\S]*>/i.test(value)) {
    return value || "<p></p>";
  }

  const lines = value.split("\n");
  const html: string[] = [];
  let listItems: string[] = [];

  function flushList() {
    if (listItems.length) {
      html.push(`<ul>${listItems.map((item) => `<li>${applyInlineMarkdown(item)}</li>`).join("")}</ul>`);
      listItems = [];
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    const { align, text } = parseAlignment(trimmed);

    if (text.startsWith("- ")) {
      listItems.push(text.slice(2));
      continue;
    }

    flushList();
    const alignment = align ? ` style="text-align: ${align}"` : "";

    if (text.startsWith("### ")) {
      html.push(`<h3${alignment}>${applyInlineMarkdown(text.slice(4))}</h3>`);
    } else if (text.startsWith("## ")) {
      html.push(`<h2${alignment}>${applyInlineMarkdown(text.slice(3))}</h2>`);
    } else if (text.startsWith("# ")) {
      html.push(`<h1${alignment}>${applyInlineMarkdown(text.slice(2))}</h1>`);
    } else {
      html.push(`<p${alignment}>${applyInlineMarkdown(text)}</p>`);
    }
  }

  flushList();
  return html.join("") || "<p></p>";
}

export function PageEditorForm({ action, children }: PageEditorFormProps) {
  const [uploadError, setUploadError] = useState("");
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);

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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const fileInputs = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    const files = fileInputs.flatMap((input) => Array.from(input.files ?? []));
    const oversizedFile = files.find((file) => file.size > MAX_FILE_BYTES);
    const totalSize = files.reduce((total, file) => total + file.size, 0);

    if (oversizedFile) {
      event.preventDefault();
      setUploadError(`The image “${oversizedFile.name}” is ${formatBytes(oversizedFile.size)}. Please choose an image under ${formatBytes(MAX_FILE_BYTES)}.`);
      return;
    }

    if (totalSize > MAX_TOTAL_FILE_BYTES) {
      event.preventDefault();
      setUploadError(`The selected images total ${formatBytes(totalSize)}. Please keep all images under ${formatBytes(MAX_TOTAL_FILE_BYTES)} per save.`);
      return;
    }

    setUploadError("");
    submitting.current = true;
    setDirty(false);
  }

  return (
    <form
      ref={formRef}
      className="editor-form"
      action={action}
      onInput={() => setDirty(true)}
      onChange={() => setDirty(true)}
      onSubmit={handleSubmit}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {dirty ? "Unsaved changes. Save before leaving this editor." : ""}
      </p>
      {uploadError ? (
        <section className="notice-card notice-card--error" role="alert">
          <strong>Image upload is too large</strong>
          <p>{uploadError}</p>
        </section>
      ) : null}
      {children}
    </form>
  );
}

export function PageCoreFields({ initialTitle = "", initialSlug = "", initialPageKey = "", existingSlugs }: PageCoreFieldsProps) {
  const [title, setTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug);
  const [slugWasEdited, setSlugWasEdited] = useState(Boolean(initialSlug));
  const normalizedInitialSlug = slugify(initialSlug);
  const normalizedSlug = slugify(slug);
  const existingSlugSet = useMemo(
    () => new Set(existingSlugs.map(slugify).filter((item) => item && item !== normalizedInitialSlug)),
    [existingSlugs, normalizedInitialSlug],
  );
  const slugExists = Boolean(normalizedSlug && existingSlugSet.has(normalizedSlug));

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!slugWasEdited) {
      setSlug(slugify(value));
    }
  }

  function handleSlugChange(value: string) {
    setSlugWasEdited(true);
    setSlug(slugify(value));
  }

  return (
    <div className="editor-grid editor-grid--two">
      <label>
        <span>Page title</span>
        <input name="title" required value={title} onChange={(event) => handleTitleChange(event.target.value)} />
        <small>The name editors will see for this page.</small>
      </label>
      <label>
        <span>Page URL</span>
        <input
          name="slug"
          required
          value={slug}
          onChange={(event) => handleSlugChange(event.target.value)}
          aria-invalid={slugExists}
          placeholder="about-pastor-wood"
        />
        <input type="hidden" name="pageKey" value={initialPageKey || normalizedSlug} />
        <small>The unique part of the web address for this page. Example: about-pastor-wood</small>
        {slugExists ? <strong className="field-error">This page URL is already in use.</strong> : null}
      </label>
    </div>
  );
}

export function RichTextArea({ name, defaultValue = "", rows = 10, helpText }: RichTextAreaProps) {
  const [value, setValue] = useState(markdownToHtml(defaultValue));
  const valueInputRef = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    immediatelyRender: false,
    content: markdownToHtml(defaultValue),
    editorProps: {
      attributes: {
        class: "tiptap-editor-surface",
        style: `min-height: ${Math.max(rows, 8) * 2.15}rem`,
      },
    },
    onUpdate: ({ editor }) => {
      setValue(editor.getHTML());
      valueInputRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
    },
  });

  function setLink() {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Enter the link URL", previousUrl ?? "https://");

    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  return (
    <div className="rich-text-field">
      <span>Main content</span>
      <input ref={valueInputRef} type="hidden" name={name} value={value} />
      <div className="rich-text-control rich-text-control--editor" data-empty={!value.trim()}>
        <div className="rich-text-toolbar" aria-label="Rich text formatting tools">
          <select
            aria-label="Text style"
            value={editor?.isActive("heading", { level: 2 }) ? "heading" : "paragraph"}
            onChange={(event) => {
              if (!editor) return;
              if (event.target.value === "heading") {
                editor.chain().focus().toggleHeading({ level: 2 }).run();
              } else {
                editor.chain().focus().setParagraph().run();
              }
            }}
          >
            <option value="paragraph">Paragraph</option>
            <option value="heading">Heading</option>
          </select>
          <button type="button" className={editor?.isActive("bold") ? "is-active" : ""} onClick={() => editor?.chain().focus().toggleBold().run()}>B</button>
          <button type="button" className={editor?.isActive("italic") ? "is-active" : ""} onClick={() => editor?.chain().focus().toggleItalic().run()}><em>I</em></button>
          <button type="button" className={editor?.isActive("underline") ? "is-active" : ""} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></button>
          <button type="button" className={editor?.isActive("bulletList") ? "is-active" : ""} onClick={() => editor?.chain().focus().toggleBulletList().run()}>• List</button>
          <button type="button" className={editor?.isActive("orderedList") ? "is-active" : ""} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1. List</button>
          <button type="button" className={editor?.isActive({ textAlign: "left" }) ? "is-active" : ""} onClick={() => editor?.chain().focus().setTextAlign("left").run()}>Left</button>
          <button type="button" className={editor?.isActive({ textAlign: "center" }) ? "is-active" : ""} onClick={() => editor?.chain().focus().setTextAlign("center").run()}>Center</button>
          <button type="button" className={editor?.isActive({ textAlign: "right" }) ? "is-active" : ""} onClick={() => editor?.chain().focus().setTextAlign("right").run()}>Right</button>
          <button type="button" className={editor?.isActive("link") ? "is-active" : ""} onClick={() => setLink()}>Link</button>
          <button type="button" onClick={() => editor?.chain().focus().undo().run()}>Undo</button>
          <button type="button" onClick={() => editor?.chain().focus().redo().run()}>Redo</button>
        </div>
        <EditorContent editor={editor} />
        <div className="rich-text-editor-footer">Saves as basic rich text for the public site.</div>
      </div>
      <small>{helpText ?? "Add the main text for this section."}</small>
    </div>
  );
}

function ImageSectionFields({
  prefix,
  imageSide = "right",
  imageDescription = "",
  imageName = "",
  imageUrl = "",
  imageAlt = "",
}: {
  prefix: string;
  imageSide?: "none" | "left" | "right" | "";
  imageDescription?: string;
  imageName?: string;
  imageUrl?: string;
  imageAlt?: string;
}) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewName, setPreviewName] = useState("");
  const visibleImageUrl = previewUrl || imageUrl;
  const visibleImageName = previewName || imageName;

  return (
    <div className="media-editor-card">
      <div className="media-editor-card__preview">
        {visibleImageUrl ? (
          <img src={visibleImageUrl} alt={imageDescription || imageAlt || visibleImageName || "Section image preview"} />
        ) : (
          <div className="media-editor-card__empty">No image selected</div>
        )}
      </div>
      <div className="media-editor-card__body">
        <div>
          <p className="eyebrow">Section image</p>
          <strong>{visibleImageName || "Choose an image"}</strong>
          <p className="muted-copy">
            {previewUrl
              ? "This is the new image selected for upload. Save the page to replace the current image."
              : imageUrl
                ? "This is the image currently used for this section. Upload a new image only if you want to replace it."
                : "Upload an image that should appear with this text section."}
          </p>
        </div>
        <div className="editor-grid editor-grid--three">
          <label>
            <span>Replace image</span>
            <input
              name={`${prefix}ImageFile`}
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) {
                  setPreviewUrl("");
                  setPreviewName("");
                  return;
                }
                setPreviewUrl(URL.createObjectURL(file));
                setPreviewName(file.name);
              }}
            />
            <small>{imageUrl ? "Leave blank to keep the current image." : "Choose an image for this section."}</small>
          </label>
          <label>
            <span>Image position</span>
            <select name={`${prefix}ImageSide`} defaultValue={imageSide || "right"}>
              <option value="left">Image on left</option>
              <option value="right">Image on right</option>
            </select>
            <small>Choose where the image appears beside the text.</small>
          </label>
          <label>
            <span>Image description</span>
            <input name={`${prefix}ImageDescription`} defaultValue={imageDescription} />
            <small>For screen readers and mouse hover text.</small>
          </label>
        </div>
      </div>
    </div>
  );
}

export function ExistingSectionTypeFields({
  prefix,
  component,
  body,
  buttonLabel,
  buttonUrl,
  imageSide,
  imageDescription,
  imageName,
  imageUrl,
  imageAlt,
}: ExistingSectionBodyProps) {
  const isImageText = component === "page-sections.image-text-section";
  const isCta = component === "page-sections.cta-section";

  return (
    <>
      <RichTextArea name={`${prefix}Body`} defaultValue={body} />

      {isImageText ? (
        <ImageSectionFields
          prefix={prefix}
          imageSide={imageSide}
          imageDescription={imageDescription}
          imageName={imageName}
          imageUrl={imageUrl}
          imageAlt={imageAlt}
        />
      ) : (
        <>
          <input type="hidden" name={`${prefix}ImageSide`} value={imageSide || "right"} />
          <input type="hidden" name={`${prefix}ImageDescription`} value={imageDescription} />
        </>
      )}

      {isCta ? (
        <div className="editor-grid editor-grid--two">
          <label>
            <span>Button text</span>
            <input name={`${prefix}ButtonLabel`} defaultValue={buttonLabel} />
            <small>Example: Donate, Contact Us, Listen Now.</small>
          </label>
          <label>
            <span>Button link</span>
            <input name={`${prefix}ButtonUrl`} defaultValue={buttonUrl} />
            <small>Use a page path like /donate or a full website address.</small>
          </label>
        </div>
      ) : null}
    </>
  );
}

type NewSectionSlot = {
  id: number;
  selectedType: SectionComponent | "";
};

function AddSectionSlot({
  slot,
  index,
  existingSectionCount,
  onChangeType,
  onRemove,
}: {
  slot: NewSectionSlot;
  index: number;
  existingSectionCount: number;
  onChangeType: (id: number, value: SectionComponent | "") => void;
  onRemove: (id: number) => void;
}) {
  const selectedType = slot.selectedType;
  const isImageText = selectedType === "page-sections.image-text-section";
  const isCta = selectedType === "page-sections.cta-section";
  const prefix = `newSection${index}`;

  return (
    <div className="add-section-flow">
      <input type="hidden" name={`${prefix}Component`} value={selectedType} />

      {!selectedType ? (
        <div className="section-type-picker" role="group" aria-label="Choose section type">
          {SECTION_OPTIONS.map((option) => (
            <button key={option.value} type="button" className="section-type-card" onClick={() => onChangeType(slot.id, option.value)}>
              <span className="component-icon" aria-hidden="true">+</span>
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </button>
          ))}
        </div>
      ) : (
        <fieldset className="section-editor section-editor--new section-component-card">
          <legend className="sr-only">Add section {index + 1}</legend>
          <div className="section-component-card__header">
            <div className="section-component-card__title">
              <span className="component-icon" aria-hidden="true">+</span>
              <span>{SECTION_OPTIONS.find((option) => option.value === selectedType)?.label}</span>
              <span className="muted-copy">New section {index + 1}</span>
            </div>
            <div className="button-row">
              <button type="button" className="button button--ghost" onClick={() => onChangeType(slot.id, "")}>Change type</button>
              {index > 0 ? <button type="button" className="button button--ghost" onClick={() => onRemove(slot.id)}>Remove</button> : null}
            </div>
          </div>

          <div className="editor-grid editor-grid--two">
            <label>
              <span>Display order</span>
              <input name={`${prefix}Order`} type="number" inputMode="numeric" defaultValue={existingSectionCount + index + 1} />
              <small>Lower numbers appear higher on the page.</small>
            </label>
            <label>
              <span>Small intro label</span>
              <input name={`${prefix}Eyebrow`} />
              <small>Optional short label above the section title, such as “About” or “Resources.”</small>
            </label>
          </div>

          <label>
            <span>Section title</span>
            <input name={`${prefix}Heading`} />
          </label>

          <RichTextArea name={`${prefix}Body`} rows={5} />

          {isImageText ? <ImageSectionFields prefix={prefix} /> : null}

          {isCta ? (
            <div className="editor-grid editor-grid--two">
              <label>
                <span>Button text</span>
                <input name={`${prefix}ButtonLabel`} />
                <small>Example: Donate, Contact Us, Listen Now.</small>
              </label>
              <label>
                <span>Button link</span>
                <input name={`${prefix}ButtonUrl`} />
                <small>Use a page path like /donate or a full website address.</small>
              </label>
            </div>
          ) : null}
        </fieldset>
      )}
    </div>
  );
}

export function AddSectionFields({ existingSectionCount }: AddSectionFieldsProps) {
  const [slots, setSlots] = useState<NewSectionSlot[]>([{ id: 0, selectedType: "" }]);
  const nextId = useRef(1);

  function updateSlotType(id: number, selectedType: SectionComponent | "") {
    setSlots((current) => current.map((slot) => (slot.id === id ? { ...slot, selectedType } : slot)));
  }

  function addSlot() {
    setSlots((current) => [...current, { id: nextId.current, selectedType: "" }]);
    nextId.current += 1;
  }

  function removeSlot(id: number) {
    setSlots((current) => current.filter((slot) => slot.id !== id));
  }

  return (
    <div className="add-section-flow add-section-flow--stacked">
      <input type="hidden" name="newSectionCount" value={slots.length} />
      {slots.map((slot, index) => (
        <AddSectionSlot
          key={slot.id}
          slot={slot}
          index={index}
          existingSectionCount={existingSectionCount}
          onChangeType={updateSlotType}
          onRemove={removeSlot}
        />
      ))}
      <button type="button" className="section-add-inline" onClick={addSlot}>
        <span className="section-add-panel__icon" aria-hidden="true">+</span>
        <span>Add Section</span>
      </button>
    </div>
  );
}
