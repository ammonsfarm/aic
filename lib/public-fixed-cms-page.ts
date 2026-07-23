import "server-only";

import { notFound } from "next/navigation";

import type { StrapiPage } from "@/lib/strapi";
import { getStrapiPageByPageKeyResult } from "@/lib/strapi";

export async function getPublicFixedCmsPage(pageKey: string): Promise<StrapiPage | null> {
  const result = await getStrapiPageByPageKeyResult(pageKey);
  if (result.status === "not-found") notFound();
  return result.status === "found"
    ? { ...result.page, continuityDegraded: result.degraded === true }
    : null;
}
