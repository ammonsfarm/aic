import "server-only";

import path from "node:path";

import { pastorWoodPublicCmsCutoverEnabled } from "@/lib/pastorwood-public-cms-cutover";
import { getProjectedPublicMedia } from "@/lib/public-content-projection";

export async function authorizedPublishedCmsMedia(documentId: string) {
  if (!pastorWoodPublicCmsCutoverEnabled()) return null;
  return getProjectedPublicMedia(documentId);
}

export function resolveCmsMediaPath(filename: string, root = process.env.STRAPI_MEDIA_ROOT || "/mnt/storage/pastorwood-media/strapi/uploads") {
  if (!filename || filename !== path.basename(filename) || filename === "." || filename === ".." || /[\u0000-\u001f]/.test(filename)) return null;
  const resolvedRoot = path.resolve(root);
  const filePath = path.resolve(resolvedRoot, filename);
  return filePath.startsWith(`${resolvedRoot}${path.sep}`) ? { root: resolvedRoot, filePath } : null;
}
