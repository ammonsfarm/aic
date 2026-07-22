"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";

import { safeCmsHref } from "@/lib/cms-html";
import { requireContentManagerApiUser } from "@/lib/rbac";
import { STRAPI_PAGES_CACHE_TAG, strapiPageCacheTag } from "@/lib/strapi";
import { STRAPI_PUBLIC_MEDIA_CACHE_TAG } from "@/lib/strapi-cache-tags";
import { STRAPI_SITE_SETTINGS_CACHE_TAG } from "@/lib/strapi-site-settings";
import {
  unpublishManagedSiteSettings,
  updateManagedSiteSettings,
  type ManagedNavigationItemInput,
  type ManagedSiteSettingsInput,
} from "@/lib/strapi-site-settings-management";

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function formNumber(formData: FormData, key: string) {
  const value = formString(formData, key);
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function parseNavigationItem(formData: FormData, prefix: string): ManagedNavigationItemInput | null {
  const remove = formBoolean(formData, `${prefix}Remove`);
  if (remove) {
    return null;
  }

  const label = formString(formData, `${prefix}Label`);
  const requestedUrl = formString(formData, `${prefix}Url`);
  const url = safeCmsHref(requestedUrl);
  const pageDocumentId = formString(formData, `${prefix}PageDocumentId`);

  if (!label && !url && !pageDocumentId) {
    return null;
  }
  if (requestedUrl && !url) {
    throw new Error(`Navigation URL “${requestedUrl}” is not allowed.`);
  }

  if (!label) {
    throw new Error("Every navigation item needs a label.");
  }

  if (!url && !pageDocumentId) {
    throw new Error(`Navigation item \"${label}\" needs either a URL or a linked page.`);
  }

  return {
    id: formNumber(formData, `${prefix}Id`) ?? undefined,
    label,
    url,
    pageDocumentId,
    order: formNumber(formData, `${prefix}Order`),
    active: formBoolean(formData, `${prefix}Active`),
  };
}

function parseNavigationGroup(formData: FormData, groupName: string) {
  const count = formNumber(formData, `${groupName}Count`) ?? 0;
  const parsed: ManagedNavigationItemInput[] = [];

  for (let index = 0; index < count; index += 1) {
    const item = parseNavigationItem(formData, `${groupName}${index}`);
    if (item) {
      parsed.push(item);
    }
  }

  const newItem = parseNavigationItem(formData, `${groupName}New`);
  if (newItem) {
    parsed.push(newItem);
  }

  return parsed.sort((left, right) => (left.order ?? 9999) - (right.order ?? 9999));
}

function parseSiteSettingsInput(formData: FormData): ManagedSiteSettingsInput {
  const siteName = formString(formData, "siteName");
  if (!siteName) {
    throw new Error("Site name is required.");
  }

  const requestedDonateUrl = formString(formData, "donateButtonUrl");
  const donateButtonUrl = safeCmsHref(requestedDonateUrl);
  if (requestedDonateUrl && !donateButtonUrl) {
    throw new Error("Donate button URL is not allowed.");
  }

  return {
    siteName,
    topNavigation: parseNavigationGroup(formData, "topNavigation"),
    utilityNavigation: parseNavigationGroup(formData, "utilityNavigation"),
    footerNavigation: parseNavigationGroup(formData, "footerNavigation"),
    footerText: formString(formData, "footerText"),
    copyrightText: formString(formData, "copyrightText"),
    showDonateButton: formBoolean(formData, "showDonateButton"),
    donateButtonLabel: formString(formData, "donateButtonLabel"),
    donateButtonUrl,
  };
}

function revalidateSiteSettingsEditor() {
  revalidatePath("/content/site-settings");
}

function revalidatePublishedSiteSettings() {
  revalidateTag(STRAPI_SITE_SETTINGS_CACHE_TAG, { expire: 0 });
  revalidateTag(STRAPI_PAGES_CACHE_TAG, { expire: 0 });
  revalidateTag(STRAPI_PUBLIC_MEDIA_CACHE_TAG, { expire: 0 });
  revalidateTag(strapiPageCacheTag("site-settings"), { expire: 0 });
  revalidatePath("/", "layout");
  revalidatePath("/sitemap.xml", "page");
}

export async function saveSiteSettingsAction(formData: FormData) {
  await requireContentManagerApiUser();
  const input = parseSiteSettingsInput(formData);
  const action = formString(formData, "publicationAction");

  if (action === "unpublish") {
    await updateManagedSiteSettings(input, "draft");
    await unpublishManagedSiteSettings();
    revalidateSiteSettingsEditor();
    revalidatePublishedSiteSettings();
    redirect("/content/site-settings?state=unpublished");
  }

  const status = action === "publish" ? "published" : "draft";
  await updateManagedSiteSettings(input, status);
  revalidateSiteSettingsEditor();
  if (status === "published") {
    revalidatePublishedSiteSettings();
  }
  redirect(`/content/site-settings?state=${status === "published" ? "published" : "draft-saved"}`);
}
