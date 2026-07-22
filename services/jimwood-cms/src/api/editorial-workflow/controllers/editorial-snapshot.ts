export type AttributeSchema = {
  type?: string;
  component?: string;
  repeatable?: boolean;
};

export type SnapshotSchemaResolver = {
  contentTypeAttributes(uid: string): Record<string, AttributeSchema>;
  componentTypeAttributes(uid: string): Record<string, AttributeSchema>;
};

type DocumentRecord = Record<string, unknown>;

function cloneSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneSnapshotValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    result[key] = cloneSnapshotValue(child);
  }
  return result;
}

const topLevelSystemFields = new Set([
  'id',
  'documentId',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'locale',
  'localizations',
]);

export function snapshotForRevision(document: DocumentRecord) {
  const snapshot: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (!topLevelSystemFields.has(key)) {
      snapshot[key] = cloneSnapshotValue(value);
    }
  }
  return snapshot;
}

function mediaReference(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(mediaReference).filter((item) => item !== null && item !== undefined);
  }
  if (value && typeof value === 'object') {
    return Object.prototype.hasOwnProperty.call(value, 'id')
      ? (value as { id: unknown }).id
      : null;
  }
  return value;
}

function relationReference(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(relationReference).filter((item) => item !== null && item !== undefined);
  }
  if (value && typeof value === 'object') {
    const relation = value as Record<string, unknown>;
    if (typeof relation.documentId === 'string' && relation.documentId) {
      return {
        documentId: relation.documentId,
        ...(typeof relation.__type === 'string' && relation.__type ? { __type: relation.__type } : {}),
      };
    }
    return Object.prototype.hasOwnProperty.call(relation, 'id') ? relation.id : null;
  }
  return value;
}

function writableComponent(
  uid: string,
  value: unknown,
  resolver: SnapshotSchemaResolver,
): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const source = value as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const [name, attribute] of Object.entries(resolver.componentTypeAttributes(uid))) {
    if (!(name in source) || attribute.type === 'password') {
      continue;
    }
    data[name] = writableAttribute(attribute, source[name], resolver);
  }
  return data;
}

function writableDynamicZone(value: unknown, resolver: SnapshotSchemaResolver) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const source = item as Record<string, unknown>;
    const component = typeof source.__component === 'string' ? source.__component : '';
    if (!component) {
      return [];
    }
    return [{
      __component: component,
      ...(writableComponent(component, source, resolver) as Record<string, unknown>),
    }];
  });
}

function writableAttribute(
  attribute: AttributeSchema,
  value: unknown,
  resolver: SnapshotSchemaResolver,
): unknown {
  if (attribute.type === 'media') {
    return mediaReference(value);
  }
  if (attribute.type === 'relation') {
    return relationReference(value);
  }
  if (attribute.type === 'component' && attribute.component) {
    if (attribute.repeatable) {
      return Array.isArray(value)
        ? value.map((item) => writableComponent(attribute.component!, item, resolver))
        : [];
    }
    return writableComponent(attribute.component, value, resolver);
  }
  if (attribute.type === 'dynamiczone') {
    return writableDynamicZone(value, resolver);
  }
  return cloneSnapshotValue(value);
}

export function writableSnapshot(
  uid: string,
  snapshot: Record<string, unknown>,
  resolver: SnapshotSchemaResolver,
) {
  const attributes = resolver.contentTypeAttributes(uid);
  const data: Record<string, unknown> = {};

  for (const [name, attribute] of Object.entries(attributes)) {
    if (!(name in snapshot) || attribute.type === 'password') {
      continue;
    }
    data[name] = writableAttribute(attribute, snapshot[name], resolver);
  }

  return data;
}
