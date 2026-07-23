"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";

import {
  createStructuredEntry,
  getStructuredEntry,
  rollbackStructuredEntry,
  retryEpisodeProcessing,
  transitionStructuredEntry,
  updateStructuredEntry,
  uploadStructuredFile,
} from "@/lib/strapi-structured-management";
import {
  getStructuredCollection,
  slugifyStructuredContent,
  type StructuredCollectionKey,
  type StructuredFieldDefinition,
} from "@/lib/structured-content-config";
import {
  isReservedLegacyRedirectSource,
  isSafeLegacyRedirectTarget,
  normalizeLegacyRequestPath,
} from "@/lib/legacy-redirects";
import { requireContentManagerApiUser } from "@/lib/rbac";
import {
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  MAX_OTHER_BYTES,
} from "@/lib/structured-editor-upload-limits";
import {
  STRAPI_PUBLIC_MEDIA_CACHE_TAG,
  STRAPI_STRUCTURED_CACHE_TAG,
  strapiPublicMediaCacheTag,
  strapiStructuredCacheTag,
} from "@/lib/strapi-cache-tags";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const ALLOWED_EPISODE_AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/mpeg3", "audio/x-mpeg-3"]);
const BLOCKED_ACTIVE_CONTENT_TYPES = new Set(["image/svg+xml", "text/html", "application/xhtml+xml", "application/xml", "text/xml", "text/javascript", "application/javascript"]);
const EPISODE_TRACK_ID_PATTERN = /^(?:\d+|sa_\d+|wp-sermon:\d+|cms_[a-z0-9][a-z0-9_-]{0,62})$/;

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function validateUrl(value: string, label: string) {
  if (!value) {
    return null;
  }
  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a site path or a complete http(s) URL.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label} must use http or https.`);
  }
  return parsed.toString();
}

function parseField(field: StructuredFieldDefinition, formData: FormData) {
  if (field.type === "file") {
    return undefined;
  }
  if (field.type === "checkbox") {
    return formData.get(field.name) === "on";
  }

  const value = formString(formData, field.name);
  if (!value) {
    if (field.required) {
      throw new Error(`${field.label} is required.`);
    }
    return null;
  }

  if (field.type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new Error(`${field.label} must be a number.`);
    }
    return number;
  }

  if (field.type === "tags") {
    return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  }

  if (field.type === "slug") {
    const slug = slugifyStructuredContent(value);
    if (!slug) {
      throw new Error(`${field.label} must contain letters or numbers.`);
    }
    return slug;
  }

  if (field.type === "url") {
    return validateUrl(value, field.label);
  }

  if (field.type === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new Error(`${field.label} must be a valid email address.`);
    }
    return value.toLowerCase();
  }

  if (field.type === "datetime") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`${field.label} must be a valid date and time.`);
    }
    return date.toISOString();
  }

  if (field.type === "select" && field.options && !field.options.includes(value)) {
    throw new Error(`${field.label} has an unsupported value.`);
  }

  return value;
}

function validateFile(field: StructuredFieldDefinition, file: File) {
  const type = file.type.toLowerCase();
  const isImage = type.startsWith("image/");
  const isAudio = type.startsWith("audio/");
  const limit = isImage ? MAX_IMAGE_BYTES : isAudio ? MAX_AUDIO_BYTES : MAX_OTHER_BYTES;

  if (BLOCKED_ACTIVE_CONTENT_TYPES.has(type)) {
    throw new Error(`${field.label} cannot contain browser-executable active content.`);
  }
  if (isImage && !ALLOWED_IMAGE_TYPES.has(type)) {
    throw new Error(`${field.label} must be JPEG, PNG, WebP, GIF, or AVIF.`);
  }
  if (field.name === "audioFile" && (!ALLOWED_EPISODE_AUDIO_TYPES.has(type) || !file.name.toLowerCase().endsWith(".mp3"))) {
    throw new Error(`${field.label} must be an MP3 file.`);
  }

  if (file.size > limit) {
    throw new Error(
      `${field.label} exceeds the ${Math.round(limit / 1024 / 1024)} MB editor upload limit.`,
    );
  }

  if (field.accept === "image/*" && !isImage) {
    throw new Error(`${field.label} must be an image.`);
  }
  if (field.accept === "audio/*" && !isAudio) {
    throw new Error(`${field.label} must be an audio file.`);
  }
}

async function structuredPayload(
  key: StructuredCollectionKey,
  formData: FormData,
  options: { creating: boolean },
) {
  const definition = getStructuredCollection(key);
  if (!definition) {
    throw new Error("Unsupported structured content type.");
  }

  if (key === "episodes") {
    const trackId = formString(formData, "trackId");
    if (!EPISODE_TRACK_ID_PATTERN.test(trackId)) {
      throw new Error("Track ID must be numeric, sa_<number>, wp-sermon:<number>, or a safe cms_<name>.");
    }
  }

  const data: Record<string, unknown> = {};
  for (const field of definition.fields) {
    if (field.type === "file") {
      const candidate = formData.get(field.name);
      if (candidate instanceof File && candidate.size > 0) {
        validateFile(field, candidate);
        const uploaded = await uploadStructuredFile(candidate);
        if (uploaded && field.mediaTarget) {
          data[field.mediaTarget] = uploaded.id;
        }
      } else if (field.required && options.creating) {
        throw new Error(`${field.label} is required.`);
      }
      continue;
    }

    data[field.name] = parseField(field, formData);
  }

  if (key === "redirects") {
    const fromPath = normalizeLegacyRequestPath(String(data.fromPath || ""));
    const toPath = normalizeLegacyRequestPath(String(data.toPath || ""));
    if (!fromPath || isReservedLegacyRedirectSource(fromPath)) {
      throw new Error("Legacy path must be a non-reserved site path beginning with one slash.");
    }
    if (!toPath || !isSafeLegacyRedirectTarget(toPath)) {
      throw new Error("Redirect destination must be a non-reserved path on this site.");
    }
    if (toPath.replace(/\/+$/, "").toLowerCase() === fromPath.replace(/\/+$/, "").toLowerCase()) {
      throw new Error("A redirect cannot point to itself.");
    }
    const statusCode = Number(data.statusCode);
    if (![301, 302, 307, 308].includes(statusCode)) {
      throw new Error("Redirect status must be 301, 302, 307, or 308.");
    }
    data.fromPath = fromPath;
    data.toPath = toPath;
    data.statusCode = statusCode;
  }

  return data;
}

function revalidateStructuredPaths(key: StructuredCollectionKey, documentId?: string) {
  const definition = getStructuredCollection(key);
  revalidatePath("/content");
  revalidatePath("/content/workflow");
  revalidatePath(`/content/structured/${key}`);
  if (definition) {
    revalidatePath(definition.editorPath);
  }
  if (documentId) {
    revalidatePath(`/content/structured/${key}/${documentId}`);
    revalidatePath(`/content/structured/${key}/${documentId}/preview`);
    if (definition) {
      revalidatePath(`${definition.editorPath}/${documentId}`);
      revalidatePath(`${definition.editorPath}/${documentId}/preview`);
    }
  }

  for (const tag of [
    STRAPI_STRUCTURED_CACHE_TAG,
    strapiStructuredCacheTag(key),
    STRAPI_PUBLIC_MEDIA_CACHE_TAG,
    ...(documentId ? [strapiPublicMediaCacheTag(documentId)] : []),
  ]) {
    revalidateTag(tag, { expire: 0 });
  }
  revalidatePath("/sitemap.xml");

  const publicPaths: Partial<Record<StructuredCollectionKey, string[]>> = {
    posts: ["/bible-study", "/written-resources", "/writings"],
    episodes: ["/radio"],
    people: ["/board-members"],
    endorsements: ["/endorsements"],
  };
  for (const path of publicPaths[key] || []) {
    revalidatePath(path);
  }
  if (key === "posts") {
    revalidatePath("/writings/[slug]", "page");
  }
  if (key === "episodes") {
    revalidatePath("/radio/[[...slug]]", "page");
  }
}

export async function createStructuredEntryAction(key: StructuredCollectionKey, formData: FormData) {
  const user = await requireContentManagerApiUser();
  const definition = getStructuredCollection(key);
  if (!definition) {
    throw new Error("Unsupported structured content type.");
  }

  const data = await structuredPayload(key, formData, { creating: true });
  const entry = await createStructuredEntry(key, data, user, formString(formData, "changeNote"));
  revalidateStructuredPaths(key, entry.documentId);
  redirect(`${definition.editorPath}/${entry.documentId}?created=1`);
}

export async function saveStructuredEntryAction(
  key: StructuredCollectionKey,
  documentId: string,
  formData: FormData,
) {
  const user = await requireContentManagerApiUser();
  const data = await structuredPayload(key, formData, { creating: false });
  await updateStructuredEntry(key, documentId, data, user, formString(formData, "changeNote"));
  revalidateStructuredPaths(key, documentId);
  const definition = getStructuredCollection(key);
  redirect(`${definition?.editorPath || `/content/structured/${key}`}/${documentId}?saved=1`);
}

export async function transitionStructuredEntryAction(
  key: StructuredCollectionKey,
  documentId: string,
  action: "publish" | "unpublish" | "archive" | "restore",
  formData: FormData,
) {
  const user = await requireContentManagerApiUser();
  await transitionStructuredEntry(
    key,
    documentId,
    action,
    user,
    formString(formData, "transitionNote"),
  );
  revalidateStructuredPaths(key, documentId);
  const definition = getStructuredCollection(key);
  redirect(`${definition?.editorPath || `/content/structured/${key}`}/${documentId}?${action}=1`);
}

export async function retryEpisodeProcessingAction(documentId: string, formData: FormData) {
  const user = await requireContentManagerApiUser();
  await retryEpisodeProcessing(documentId, user, formString(formData, "processingRetryNote"));
  revalidateStructuredPaths("episodes", documentId);
  redirect(`/content/podcast/${documentId}?processingRetry=1`);
}

export async function rollbackStructuredEntryAction(
  key: StructuredCollectionKey,
  documentId: string,
  revisionDocumentId: string,
  formData: FormData,
) {
  const user = await requireContentManagerApiUser();
  await rollbackStructuredEntry(
    key,
    documentId,
    revisionDocumentId,
    user,
    formString(formData, "rollbackNote"),
  );
  revalidateStructuredPaths(key, documentId);
  const definition = getStructuredCollection(key);
  redirect(`${definition?.editorPath || `/content/structured/${key}`}/${documentId}?rolledBack=1`);
}

export async function deleteStructuredEntryAction(
  key: StructuredCollectionKey,
  documentId: string,
  expectedTitle: string,
  formData: FormData,
) {
  const user = await requireContentManagerApiUser();
  const definition = getStructuredCollection(key);
  if (!definition) {
    throw new Error("Unsupported structured content type.");
  }
  const current = await getStructuredEntry(key, documentId);
  if (!current) {
    throw new Error("The content item no longer exists in Strapi.");
  }
  const currentTitle = String(current[definition.titleField] || "Untitled");
  const confirmation = formString(formData, "deleteConfirmation");
  if (currentTitle !== expectedTitle) {
    throw new Error("The item title changed after this editor was opened. Reload before deleting it.");
  }
  if (!confirmation || confirmation !== currentTitle) {
    throw new Error("Deletion confirmation must exactly match the current item title.");
  }

  await transitionStructuredEntry(
    key,
    documentId,
    "delete",
    user,
    formString(formData, "deleteNote") || "Deleted from the AIC content manager.",
    confirmation,
  );
  revalidateStructuredPaths(key);
  redirect(`${definition?.editorPath || `/content/structured/${key}`}?deleted=1`);
}
