export const STRAPI_STRUCTURED_CACHE_TAG = "strapi-structured";
export const STRAPI_PUBLIC_MEDIA_CACHE_TAG = "strapi-public-media";

export function strapiStructuredCacheTag(collection: string) {
  return `${STRAPI_STRUCTURED_CACHE_TAG}-${collection}`;
}

export function strapiPublicMediaCacheTag(documentId: string) {
  return `${STRAPI_PUBLIC_MEDIA_CACHE_TAG}-${documentId}`;
}
