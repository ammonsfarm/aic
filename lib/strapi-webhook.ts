const PUBLICATION_EVENTS = new Set([
  "entry.publish",
  "entry.unpublish",
  "entry.delete",
]);

export function strapiWebhookEvent(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const value = record.event ?? record.type ?? record.action;
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isPublicStrapiChange(payload: unknown) {
  return PUBLICATION_EVENTS.has(strapiWebhookEvent(payload));
}
