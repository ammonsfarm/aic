export const STRUCTURED_COLLECTION_KEYS = [
  "posts",
  "episodes",
  "people",
  "endorsements",
  "media-assets",
  "redirects",
] as const;

export type StructuredCollectionKey = (typeof STRUCTURED_COLLECTION_KEYS)[number];

export type StructuredFieldType =
  | "text"
  | "textarea"
  | "richtext"
  | "slug"
  | "select"
  | "checkbox"
  | "number"
  | "date"
  | "datetime"
  | "url"
  | "email"
  | "tags"
  | "file";

export type StructuredFieldDefinition = {
  name: string;
  label: string;
  type: StructuredFieldType;
  required?: boolean;
  help?: string;
  options?: readonly string[];
  accept?: string;
  mediaTarget?: string;
};

export type StructuredCollectionDefinition = {
  key: StructuredCollectionKey;
  apiPath: string;
  entityType: "post" | "episode" | "person" | "endorsement" | "media-asset" | "redirect";
  singularLabel: string;
  pluralLabel: string;
  description: string;
  titleField: string;
  slugField?: string;
  publishable: boolean;
  editorPath: string;
  fields: readonly StructuredFieldDefinition[];
  listColumns: readonly string[];
};

export const STRUCTURED_COLLECTIONS: Record<StructuredCollectionKey, StructuredCollectionDefinition> = {
  posts: {
    key: "posts",
    apiPath: "posts",
    entityType: "post",
    singularLabel: "post or writing",
    pluralLabel: "Posts and writings",
    description: "Devotionals, Bible studies, articles, newsletters, and written resources.",
    titleField: "title",
    slugField: "slug",
    publishable: true,
    editorPath: "/content/posts",
    listColumns: ["contentType", "publishDate"],
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "slug", label: "URL slug", type: "slug", required: true, help: "Stable public URL. It is not changed automatically after creation." },
      {
        name: "contentType",
        label: "Content type",
        type: "select",
        required: true,
        options: ["devotional", "bible-study", "article", "written-resource", "newsletter-archive"],
      },
      { name: "summary", label: "Summary", type: "textarea" },
      { name: "body", label: "Body", type: "richtext", required: true, help: "HTML is allowed and sanitized by the public renderer." },
      { name: "topics", label: "Topics", type: "tags", help: "Comma-separated topics." },
      { name: "publishDate", label: "Editorial publish date", type: "datetime" },
      { name: "scheduledFor", label: "Scheduled for", type: "datetime" },
      { name: "legacyUrl", label: "Legacy URL", type: "url" },
      { name: "featuredImageFile", label: "Featured image", type: "file", accept: "image/*", mediaTarget: "featuredImage" },
    ],
  },
  episodes: {
    key: "episodes",
    apiPath: "episodes",
    entityType: "episode",
    singularLabel: "episode",
    pluralLabel: "Radio episodes",
    description: "Audio metadata, public archive details, and processing status.",
    titleField: "title",
    slugField: "slug",
    publishable: true,
    editorPath: "/content/podcast",
    listColumns: ["programDate", "trackId"],
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "slug", label: "URL slug", type: "slug", required: true },
      {
        name: "trackId",
        label: "Track ID",
        type: "text",
        required: true,
        help: "Permanent processing identity: a SoundCloud number, sa_<number>, wp-sermon:<number>, or a stable cms_<name>. It cannot change after first publication.",
      },
      { name: "episodeNumber", label: "Episode number", type: "number" },
      { name: "programDate", label: "Program date", type: "date" },
      { name: "summary", label: "Summary", type: "textarea" },
      { name: "description", label: "Description", type: "richtext" },
      { name: "externalAudioUrl", label: "Existing audio URL", type: "url" },
      { name: "audioFile", label: "Upload MP3 audio", type: "file", accept: "audio/mpeg,.mp3", mediaTarget: "audio", help: "MP3 is required for automatic transcript, intelligence, and vector processing." },
      { name: "durationSeconds", label: "Duration in seconds", type: "number" },
      { name: "publishDate", label: "Editorial publish date", type: "datetime" },
      { name: "scheduledFor", label: "Scheduled for", type: "datetime" },
      { name: "legacyUrl", label: "Legacy URL", type: "url" },
      { name: "featuredImageFile", label: "Featured image", type: "file", accept: "image/*", mediaTarget: "featuredImage" },
    ],
  },
  people: {
    key: "people",
    apiPath: "people",
    entityType: "person",
    singularLabel: "person",
    pluralLabel: "People and board",
    description: "Authors, staff, guests, speakers, and board members.",
    titleField: "name",
    slugField: "slug",
    publishable: true,
    editorPath: "/content/people",
    listColumns: ["title", "showOnBoard"],
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "slug", label: "URL slug", type: "slug", required: true },
      { name: "title", label: "Title or role", type: "text" },
      { name: "organization", label: "Organization", type: "text" },
      { name: "biography", label: "Biography", type: "richtext" },
      { name: "email", label: "Public email", type: "email" },
      { name: "website", label: "Website", type: "url" },
      { name: "roles", label: "Editorial roles", type: "tags", help: "Examples: author, board, guest, staff." },
      { name: "showOnBoard", label: "Show on board page", type: "checkbox" },
      { name: "sortOrder", label: "Display order", type: "number" },
      { name: "active", label: "Active", type: "checkbox" },
      { name: "legacyUrl", label: "Legacy URL", type: "url" },
      { name: "photoFile", label: "Portrait", type: "file", accept: "image/*", mediaTarget: "photo" },
    ],
  },
  endorsements: {
    key: "endorsements",
    apiPath: "endorsements",
    entityType: "endorsement",
    singularLabel: "endorsement",
    pluralLabel: "Endorsements",
    description: "Public endorsement quotes and attribution.",
    titleField: "attribution",
    publishable: true,
    editorPath: "/content/endorsements",
    listColumns: ["organization", "featured"],
    fields: [
      { name: "quote", label: "Quote", type: "textarea", required: true },
      { name: "attribution", label: "Attribution", type: "text", required: true },
      { name: "title", label: "Title", type: "text" },
      { name: "organization", label: "Organization", type: "text" },
      { name: "sourceUrl", label: "Source URL", type: "url" },
      { name: "sortOrder", label: "Display order", type: "number" },
      { name: "featured", label: "Featured", type: "checkbox" },
      { name: "active", label: "Active", type: "checkbox" },
      { name: "photoFile", label: "Attribution photo", type: "file", accept: "image/*", mediaTarget: "photo" },
    ],
  },
  "media-assets": {
    key: "media-assets",
    apiPath: "media-assets",
    entityType: "media-asset",
    singularLabel: "media asset",
    pluralLabel: "Media library",
    description: "Reusable images, audio, video, documents, and downloads with editorial metadata.",
    titleField: "title",
    slugField: "slug",
    publishable: true,
    editorPath: "/content/media",
    listColumns: ["assetType", "credit"],
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "slug", label: "Asset slug", type: "slug", required: true },
      {
        name: "assetType",
        label: "Asset type",
        type: "select",
        required: true,
        options: ["image", "audio", "video", "document", "download", "other"],
      },
      { name: "assetFile", label: "File", type: "file", required: true, mediaTarget: "asset" },
      {
        name: "visibility",
        label: "Visibility",
        type: "select",
        required: true,
        options: ["private", "internal", "public"],
        help: "Only published assets marked public may be used by the public website.",
      },
      { name: "altText", label: "Alternative text", type: "text", help: "Required in practice for meaningful images." },
      { name: "caption", label: "Caption", type: "textarea" },
      { name: "credit", label: "Credit", type: "text" },
      { name: "sourceUrl", label: "Source URL", type: "url" },
      { name: "rights", label: "Usage rights", type: "text" },
      { name: "tags", label: "Tags", type: "tags" },
      { name: "usageNotes", label: "Usage notes", type: "textarea" },
      { name: "legacyAttachmentId", label: "Legacy attachment ID", type: "text", help: "Only IDs from the vetted WordPress attachment manifest may be imported." },
      { name: "legacyRelativePath", label: "Legacy attachment path", type: "text" },
      { name: "checksumSha256", label: "SHA-256 checksum", type: "text" },
    ],
  },
  redirects: {
    key: "redirects",
    apiPath: "redirects",
    entityType: "redirect",
    singularLabel: "redirect",
    pluralLabel: "Legacy redirects",
    description: "Verified legacy PastorWood paths and their replacement destinations.",
    titleField: "fromPath",
    publishable: false,
    editorPath: "/content/redirects",
    listColumns: ["toPath", "statusCode"],
    fields: [
      { name: "fromPath", label: "Legacy path", type: "text", required: true, help: "Must begin with /." },
      { name: "toPath", label: "Destination", type: "url", required: true },
      { name: "statusCode", label: "HTTP status", type: "select", required: true, options: ["301", "302", "307", "308"] },
      { name: "active", label: "Active", type: "checkbox" },
      { name: "notes", label: "Migration notes", type: "textarea" },
      { name: "lastVerifiedAt", label: "Last verified", type: "datetime" },
    ],
  },
};

export function isStructuredCollectionKey(value: string): value is StructuredCollectionKey {
  return STRUCTURED_COLLECTION_KEYS.includes(value as StructuredCollectionKey);
}

export function getStructuredCollection(value: string) {
  return isStructuredCollectionKey(value) ? STRUCTURED_COLLECTIONS[value] : null;
}

export function slugifyStructuredContent(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
