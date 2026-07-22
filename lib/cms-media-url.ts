export function cmsMediaPublicUrl(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (record.data) return cmsMediaPublicUrl(record.data);
  const source = record.attributes && typeof record.attributes === "object"
    ? { ...(record.attributes as Record<string, unknown>), ...record }
    : record;
  const documentId = typeof source.documentId === "string" ? source.documentId : "";
  const rawUrl = typeof source.url === "string" ? source.url : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(documentId) || !rawUrl) return "";
  try {
    const pathname = new URL(rawUrl, "http://strapi.invalid").pathname;
    const filename = pathname.split("/").filter(Boolean).at(-1) || "";
    if (!filename || filename === "." || filename === "..") return "";
    return `/media/cms/${encodeURIComponent(documentId)}/${encodeURIComponent(filename)}`;
  } catch {
    return "";
  }
}
