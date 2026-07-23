"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";

import { safeCmsHref } from "@/lib/cms-html";
import { safeExternalDonationUrl, safeExternalDonorDashboardUrl } from "@/lib/public-donation";
import { requireContentManagerApiUser } from "@/lib/rbac";
import { STRAPI_PAGES_CACHE_TAG, strapiPageCacheTag } from "@/lib/strapi";
import { STRAPI_PUBLIC_MEDIA_CACHE_TAG } from "@/lib/strapi-cache-tags";
import { STRAPI_SITE_SETTINGS_CACHE_TAG } from "@/lib/strapi-site-settings";
import {
  createManagedSiteSettingsWithWorkflow,
  getManagedSiteSettings,
  rollbackManagedSiteSettings,
  saveAndTransitionManagedSiteSettings,
  StrapiSiteSettingsRequestError,
  updateManagedSiteSettingsWithWorkflow,
  type ManagedNavigationItemInput,
  type ManagedSiteSettingsInput,
} from "@/lib/strapi-site-settings-management";
import { deleteStructuredFile, uploadStructuredFile } from "@/lib/strapi-structured-management";

const MAX_HEADER_LOGO_BYTES = 15 * 1024 * 1024;
const ALLOWED_HEADER_LOGO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

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

async function headerLogoSelection(formData: FormData, existingId: number | null) {
  if (formBoolean(formData, "removeHeaderLogo")) {
    return { id: null, uploadedId: null };
  }
  const file = formData.get("headerLogoFile");
  if (!(file instanceof File) || file.size === 0) {
    return { id: existingId, uploadedId: null };
  }
  if (file.size > MAX_HEADER_LOGO_BYTES) {
    throw new Error("Header logos must be 15 MB or smaller.");
  }
  if (!ALLOWED_HEADER_LOGO_TYPES.has(file.type.toLowerCase())) {
    throw new Error("Header logos must be JPEG, PNG, WebP, GIF, or AVIF images.");
  }
  const uploaded = await uploadStructuredFile(file);
  if (!uploaded?.id) {
    throw new Error("Strapi did not return the uploaded header logo.");
  }
  return { id: uploaded.id, uploadedId: uploaded.id };
}

async function parseSiteSettingsInput(
  formData: FormData,
  existingHeaderLogoId: number | null,
): Promise<{ input: ManagedSiteSettingsInput; uploadedLogoId: number | null }> {
  const siteName = formString(formData, "siteName");
  if (!siteName) {
    throw new Error("Site name is required.");
  }

  const requestedDonateUrl = formString(formData, "donateButtonUrl");
  const donateButtonUrl = requestedDonateUrl.startsWith("/")
    ? safeCmsHref(requestedDonateUrl)
    : safeExternalDonationUrl(requestedDonateUrl);
  if (requestedDonateUrl && !donateButtonUrl) {
    throw new Error("Donate button URL must be a same-site path, the canonical GiveWP form, or an allowlisted HTTPS provider URL.");
  }

  const requestedDonorDashboardUrl = formString(formData, "donorDashboardUrl");
  const donorDashboardUrl = safeExternalDonorDashboardUrl(requestedDonorDashboardUrl);
  if (requestedDonorDashboardUrl && !donorDashboardUrl) {
    throw new Error("Donor dashboard URL must be the canonical dashboard or an allowlisted HTTPS dashboard provider URL.");
  }

  const topNavigation = parseNavigationGroup(formData, "topNavigation");
  const utilityNavigation = parseNavigationGroup(formData, "utilityNavigation");
  const footerNavigation = parseNavigationGroup(formData, "footerNavigation");
  const logo = await headerLogoSelection(formData, existingHeaderLogoId);
  return {
    input: {
      siteName,
      topNavigation,
      utilityNavigation,
      footerNavigation,
      footerText: formString(formData, "footerText"),
      copyrightText: formString(formData, "copyrightText"),
      showDonateButton: formBoolean(formData, "showDonateButton"),
      donateButtonLabel: formString(formData, "donateButtonLabel"),
      donateButtonUrl: donateButtonUrl || "",
      donorDashboardUrl: donorDashboardUrl || "",
      headerLogoId: logo.id,
      subscriptionEnabled: formBoolean(formData, "subscriptionEnabled"),
    },
    uploadedLogoId: logo.uploadedId,
  };
}

async function cleanupRejectedHeaderLogo(fileId: number | null, error: unknown) {
  if (
    !fileId ||
    !(error instanceof StrapiSiteSettingsRequestError) ||
    error.status < 400 ||
    error.status >= 500
  ) {
    return;
  }
  try {
    await deleteStructuredFile(fileId);
  } catch (cleanupError) {
    console.error(`Failed to remove rejected header-logo upload ${fileId}.`, cleanupError);
  }
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
  const user = await requireContentManagerApiUser();
  const current = await getManagedSiteSettings();
  if (!current) {
    throw new Error("Site settings have not been initialized.");
  }
  const expectedUpdatedAt = formString(formData, "expectedUpdatedAt");
  if (!expectedUpdatedAt || expectedUpdatedAt !== current.updatedAt) {
    throw new Error("Site settings changed after this editor was loaded. Reload before saving.");
  }
  const action = formString(formData, "publicationAction");
  if (action !== "draft" && action !== "publish" && action !== "unpublish") {
    throw new Error("Unsupported site-settings publication action.");
  }
  const note = formString(formData, "changeNote");
  const { input, uploadedLogoId } = await parseSiteSettingsInput(formData, current.headerLogo?.id ?? null);

  try {
    if (action === "publish" || action === "unpublish") {
      await saveAndTransitionManagedSiteSettings(
        current.documentId,
        action,
        input,
        user,
        expectedUpdatedAt,
        note,
      );
    } else {
      await updateManagedSiteSettingsWithWorkflow(current.documentId, input, user, expectedUpdatedAt, note);
    }
  } catch (error) {
    await cleanupRejectedHeaderLogo(uploadedLogoId, error);
    throw error;
  }

  revalidateSiteSettingsEditor();
  if (action === "publish" || action === "unpublish") {
    revalidatePublishedSiteSettings();
  }
  redirect(`/content/site-settings?state=${action === "publish" ? "published" : action === "unpublish" ? "unpublished" : "draft-saved"}`);
}

export async function initializeSiteSettingsAction() {
  const user = await requireContentManagerApiUser();
  const current = await getManagedSiteSettings();
  if (current) {
    redirect("/content/site-settings");
  }
  await createManagedSiteSettingsWithWorkflow(
    {
      siteName: "Abiding in Christ",
      topNavigation: [],
      footerNavigation: [],
      utilityNavigation: [],
      footerText: "A ministry of Jim Wood.",
      copyrightText: `© ${new Date().getUTCFullYear()} Abiding in Christ. All rights reserved.`,
      showDonateButton: true,
      donateButtonLabel: "Donate",
      donateButtonUrl: "/donate/",
      donorDashboardUrl: "https://www.pastorwood.org/donor-dashboard/",
      headerLogoId: null,
      subscriptionEnabled: true,
    },
    user,
    "Initialized site settings from the AIC content manager.",
  );
  revalidateSiteSettingsEditor();
  redirect("/content/site-settings?state=initialized");
}

export async function rollbackSiteSettingsAction(
  documentId: string,
  revisionDocumentId: string,
  formData: FormData,
) {
  const user = await requireContentManagerApiUser();
  const current = await getManagedSiteSettings();
  if (!current || current.documentId !== documentId) {
    throw new Error("Site settings changed or no longer exist. Reload before restoring a revision.");
  }
  const expectedUpdatedAt = formString(formData, "expectedUpdatedAt");
  if (!expectedUpdatedAt || expectedUpdatedAt !== current.updatedAt) {
    throw new Error("Site settings changed after this revision list was loaded. Reload before restoring.");
  }
  await rollbackManagedSiteSettings(
    documentId,
    revisionDocumentId,
    user,
    expectedUpdatedAt,
    formString(formData, "rollbackNote"),
  );
  revalidateSiteSettingsEditor();
  redirect("/content/site-settings?state=rolled-back");
}
