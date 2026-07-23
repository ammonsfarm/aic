import { isDynamicCmsPublicSlug } from "@/lib/public-routes";
import { singleSegmentSlug } from "@/lib/route-access";
import { getStrapiPageBySlugResult } from "@/lib/strapi";

/**
 * Keep a published dynamic CMS page ahead of legacy redirects. When page
 * ownership cannot be checked, fail closed and let the page render its
 * temporary-unavailable state instead of risking a redirect that shadows it.
 */
export async function shouldPreserveDynamicCmsPagePath(pathname: string) {
  const slug = singleSegmentSlug(pathname);
  if (!slug || !isDynamicCmsPublicSlug(slug)) return false;
  const result = await getStrapiPageBySlugResult(slug);
  return result.status !== "not-found";
}
