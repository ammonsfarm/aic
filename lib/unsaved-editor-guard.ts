export function isSiblingEditorForm(target: EventTarget | null, editorForm: EventTarget | null) {
  if (!target || target === editorForm) return false;
  return String((target as { nodeName?: unknown }).nodeName || "").toUpperCase() === "FORM";
}
