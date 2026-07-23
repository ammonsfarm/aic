export const PRIVATE_TOP_LEVEL_SEGMENTS = new Set([
  "admin",
  "archive",
  "compose",
  "content",
  "episodes",
  "overview",
  "pipeline",
  "podcast",
  "reading-plan",
  "research",
  "sermons",
  "preview",
  "signals",
  "sources",
  "stats",
]);

export const NON_PUBLIC_LINK_SEGMENTS = new Set([
  ...PRIVATE_TOP_LEVEL_SEGMENTS,
  "api",
  "login",
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

export function isNonPublicLinkPath(pathname: string) {
  const segment = topLevelSegment(pathname);
  return Boolean(segment && NON_PUBLIC_LINK_SEGMENTS.has(segment));
}
