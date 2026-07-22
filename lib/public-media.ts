import path from "node:path";

import publicMediaManifest from "@/data/public-media-manifest.json";

export type PublicMediaManifestEntry = {
  relativePath: string;
  publicPath: string;
  sourceUrl: string;
  legacyAttachmentId: string;
  visibility: "public";
  mimeType: string;
  sizeBytes: number | null;
  exists: boolean;
  referencedBy: string[];
};

const defaultRoot = "/mnt/storage/pastorwood-media/public";

export function normalizePublicMediaSegments(segments: string[]) {
  if (!segments.length) return "";
  const clean: string[] = [];
  for (const raw of segments) {
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      return "";
    }
    if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) {
      return "";
    }
    clean.push(value);
  }
  return clean.join("/");
}

const manifestMap = new Map(
  (publicMediaManifest as PublicMediaManifestEntry[])
    .filter((entry) => entry.visibility === "public" && entry.publicPath && entry.exists)
    .map((entry) => [entry.relativePath, entry] as const),
);

export function findPublicMediaEntry(segments: string[]) {
  const relativePath = normalizePublicMediaSegments(segments);
  return relativePath ? manifestMap.get(relativePath) || null : null;
}

export function resolvePublicMediaFile(segments: string[], configuredRoot = process.env.PASTORWOOD_PUBLIC_MEDIA_ROOT || defaultRoot) {
  const entry = findPublicMediaEntry(segments);
  if (!entry) return null;
  const root = path.resolve(configuredRoot);
  const filePath = path.resolve(root, ...entry.relativePath.split("/"));
  if (filePath === root || !filePath.startsWith(`${root}${path.sep}`)) return null;
  return { entry, filePath };
}

export function parseSingleByteRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return { invalid: true as const };
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true as const };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    return { invalid: true as const };
  }
  end = Math.min(end, size - 1);
  return { invalid: false as const, start, end, length: end - start + 1 };
}
