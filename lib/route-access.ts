export const PRIVATE_TOP_LEVEL_SEGMENTS = new Set([
  "admin",
  "archive",
  "compose",
  "content",
  "overview",
  "pipeline",
  "podcast",
  "research",
  "sermons",
  "preview",
  "signals",
  "sources",
  "stats",
]);

export function topLevelSegment(pathname: string) {
  return pathname.match(/^\/([^/]+)(?:\/|$)/)?.[1]?.toLowerCase() ?? "";
}

export function singleSegmentSlug(pathname: string) {
  return pathname.match(/^\/([^/]+)\/?$/)?.[1]?.toLowerCase() ?? "";
}

export function isKnownPrivatePath(pathname: string) {
  const segment = topLevelSegment(pathname);
  return Boolean(segment && PRIVATE_TOP_LEVEL_SEGMENTS.has(segment));
}
