import { PRIVATE_TOP_LEVEL_SEGMENTS } from "@/lib/route-access";

export const RESERVED_PUBLIC_SLUGS = new Set([
  ...PRIVATE_TOP_LEVEL_SEGMENTS,
  "about-pastor-wood",
  "abiding-in-christ",
  "api",
  "app",
  "bible-study",
  "board-members",
  "contact",
  "donate",
  "donor-dashboard",
  "endorsements",
  "feed",
  "login",
  "media",
  "privacy",
  "privacy-terms-conditions",
  "radio",
  "unsubscribe",
  "writings",
  "written-resources",
  "wp-content",
]);

export function isDynamicCmsPublicSlug(slug: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && !RESERVED_PUBLIC_SLUGS.has(slug);
}
