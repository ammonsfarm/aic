type StructuredSeoInput = {
  title: string;
  description: string;
  canonicalUrl: string | null;
  noIndex: boolean;
  replacementSocialImageId?: number | null;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.data && typeof record.data === "object") return recordValue(record.data);
  if (record.attributes && typeof record.attributes === "object") {
    return { ...(record.attributes as Record<string, unknown>), ...record };
  }
  return record;
}

function positiveIntegerId(value: unknown) {
  const id = Number(recordValue(value)?.id ?? value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function structuredSeoPayload(existingValue: unknown, input: StructuredSeoInput) {
  const existing = recordValue(existingValue);
  const componentId = positiveIntegerId(existing);
  const socialImageId = positiveIntegerId(input.replacementSocialImageId) || positiveIntegerId(existing?.socialImage);
  const hasEditedMetadata = Boolean(input.title || input.description || input.canonicalUrl || input.noIndex);

  if (!componentId && !socialImageId && !hasEditedMetadata) return null;

  return {
    ...(componentId ? { id: componentId } : {}),
    title: input.title,
    description: input.description,
    canonicalUrl: input.canonicalUrl,
    noIndex: input.noIndex,
    ...(socialImageId ? { socialImage: socialImageId } : {}),
  };
}
