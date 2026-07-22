"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";

import {
  createManagedStrapiPageWithWorkflow,
  getManagedStrapiPage,
  assertManagedStrapiPageSlugAvailable,
  rollbackManagedStrapiPage,
  transitionManagedStrapiPage,
  updateManagedStrapiPageWithWorkflow,
  type ManagedStrapiPageInput,
} from "@/lib/strapi-management";
import {
  assertAllowedPageSlug,
  immutablePageKey,
} from "@/lib/cms-page-validation";
import { requireContentManagerApiUser } from "@/lib/rbac";
import { STRAPI_PAGES_CACHE_TAG, strapiPageCacheTag } from "@/lib/strapi";
import { STRAPI_PUBLIC_MEDIA_CACHE_TAG } from "@/lib/strapi-cache-tags";
import { safeCmsHref } from "@/lib/cms-html";
import { fetchWithTimeout, strapiUploadTimeoutMs } from "@/lib/strapi-request";

const PAGE_PATH_BY_KEY: Record<string, string> = {
  about: "/about-pastor-wood",
  "about-pastor-wood": "/about-pastor-wood",
  "bible-study": "/bible-study",
  "board-members": "/board-members",
  contact: "/contact",
  donate: "/donate",
  "donor-dashboard": "/donor-dashboard",
  endorsements: "/endorsements",
  home: "/",
  "privacy-terms-conditions": "/privacy-terms-conditions",
  "written-resources": "/written-resources",
};
const MAX_SECTION_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_SECTION_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

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

function strapiBaseUrl() {
  return process.env.STRAPI_URL?.replace(/\/+$/, "") || "";
}

function strapiWriteToken() {
  return process.env.STRAPI_API_TOKEN_TEMP_WRITE?.trim() || process.env.STRAPI_API_TOKEN?.trim() || "";
}

async function uploadSectionImage(file: File) {
  if (!file.size) {
    return null;
  }
  if (file.size > MAX_SECTION_IMAGE_BYTES) {
    throw new Error("Section images must be 15 MB or smaller.");
  }
  if (!ALLOWED_SECTION_IMAGE_TYPES.has(file.type.toLowerCase())) {
    throw new Error("Section images must be JPEG, PNG, WebP, GIF, or AVIF files.");
  }

  const baseUrl = strapiBaseUrl();
  const token = strapiWriteToken();
  if (!baseUrl || !token) {
    throw new Error("Image upload is not configured. Set STRAPI_URL and STRAPI_API_TOKEN_TEMP_WRITE or STRAPI_API_TOKEN.");
  }

  const uploadData = new FormData();
  uploadData.append("files", file, file.name || "section-image");

  const response = await fetchWithTimeout(
    new URL("/api/upload", baseUrl),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: uploadData,
      cache: "no-store",
    },
    strapiUploadTimeoutMs(),
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Image upload failed with ${response.status}: ${text.slice(0, 500)}`);
  }

  const uploaded = (text ? JSON.parse(text) : []) as Array<{ id?: number }>;
  return typeof uploaded[0]?.id === "number" ? uploaded[0].id : null;
}

function publicPathFor(pageKey: string, slug: string) {
  const key = pageKey.trim().toLowerCase();
  const normalizedSlug = slug.trim().toLowerCase();

  if (PAGE_PATH_BY_KEY[key]) {
    return PAGE_PATH_BY_KEY[key];
  }

  if (PAGE_PATH_BY_KEY[normalizedSlug]) {
    return PAGE_PATH_BY_KEY[normalizedSlug];
  }

  return normalizedSlug === "home" ? "/" : `/${normalizedSlug.replace(/^\/+/, "")}`;
}

async function sectionPayload(formData: FormData, keyPrefix: string) {
  const component = formString(formData, `${keyPrefix}Component`);
  const remove = formBoolean(formData, `${keyPrefix}Remove`);
  const eyebrow = formString(formData, `${keyPrefix}Eyebrow`);
  const heading = formString(formData, `${keyPrefix}Heading`);
  const body = formString(formData, `${keyPrefix}Body`);
  const buttonLabel = formString(formData, `${keyPrefix}ButtonLabel`);
  const requestedButtonUrl = formString(formData, `${keyPrefix}ButtonUrl`);
  const existingImageId = formNumber(formData, `${keyPrefix}ImageId`);
  const imageFile = formData.get(`${keyPrefix}ImageFile`);
  const uploadedImageId = imageFile instanceof File ? await uploadSectionImage(imageFile) : null;
  const imageId = uploadedImageId ?? existingImageId;
  const imageSide = formString(formData, `${keyPrefix}ImageSide`) || "right";
  const imageDescription = formString(formData, `${keyPrefix}ImageDescription`);
  const id = formNumber(formData, `${keyPrefix}Id`);
  const order = formNumber(formData, `${keyPrefix}Order`) ?? 0;
  const buttonUrl = safeCmsHref(requestedButtonUrl);
  if (requestedButtonUrl && !buttonUrl) {
    throw new Error(`Section button URL “${requestedButtonUrl}” is not allowed.`);
  }

  if (remove || !component) {
    return null;
  }

  const hasContent = Boolean(eyebrow || heading || body || buttonLabel || buttonUrl || imageId);
  if (!hasContent) {
    return null;
  }

  const base: Record<string, unknown> = {
    __component: component,
    eyebrow,
    heading,
    body,
  };

  if (id) {
    base.id = id;
  }

  if (component === "page-sections.cta-section") {
    base.buttonLabel = buttonLabel;
    base.buttonUrl = buttonUrl;
  }

  if (component === "page-sections.image-text-section") {
    base.imageSide = imageSide === "left" || imageSide === "right" || imageSide === "none" ? imageSide : "right";
    base.imageDescription = imageDescription;
    if (imageId) {
      base.image = imageId;
    }
  }

  return { order, section: base };
}

async function parseSections(formData: FormData) {
  const count = formNumber(formData, "sectionCount") ?? 0;
  const parsed = [] as Array<{ order: number; section: Record<string, unknown> }>;

  for (let index = 0; index < count; index += 1) {
    const section = await sectionPayload(formData, `section${index}`);
    if (section) {
      parsed.push(section);
    }
  }

  const newSectionCount = formNumber(formData, "newSectionCount") ?? 0;
  for (let index = 0; index < newSectionCount; index += 1) {
    const newSection = await sectionPayload(formData, `newSection${index}`);
    if (newSection) {
      parsed.push({
        ...newSection,
        order: newSection.order > 0 ? newSection.order : parsed.length + 1,
      });
    }
  }

  const legacyNewSection = await sectionPayload(formData, "newSection");
  if (legacyNewSection) {
    parsed.push({ ...legacyNewSection, order: parsed.length + 1 });
  }

  return parsed.sort((left, right) => left.order - right.order).map((item) => item.section);
}

async function parsePageInput(
  formData: FormData,
  existing?: { pageKey: string; slug: string },
): Promise<ManagedStrapiPageInput> {
  const title = formString(formData, "title");
  const slug = assertAllowedPageSlug({
    slug: formString(formData, "slug"),
    originalSlug: existing?.slug,
  });
  const pageKey = immutablePageKey({
    existingPageKey: existing?.pageKey,
    requestedPageKey: formString(formData, "pageKey"),
    slug,
  });

  if (!title || !slug || !pageKey) {
    throw new Error("Title and page URL are required.");
  }

  return {
    title,
    slug,
    pageKey,
    active: formBoolean(formData, "active"),
    showInNavigation: formBoolean(formData, "showInNavigation"),
    navigationLabel: formString(formData, "navigationLabel"),
    navigationOrder: formNumber(formData, "navigationOrder"),
    heroLabel: formString(formData, "heroLabel"),
    heroTitle: formString(formData, "heroTitle"),
    heroBody: formString(formData, "heroBody"),
    seoTitle: formString(formData, "seoTitle"),
    seoDescription: formString(formData, "seoDescription"),
    sections: await parseSections(formData),
  };
}

type PublicationIntent = "draft" | "publish" | "unpublish";

function publicationIntent(formData: FormData): PublicationIntent {
  const value = formString(formData, "publicationAction");
  return value === "publish" || value === "unpublish" ? value : "draft";
}

async function assertPageSlugIsUnique(input: ManagedStrapiPageInput, excludeDocumentId?: string) {
  await assertManagedStrapiPageSlugAvailable(input.slug, excludeDocumentId);
}

function revalidateManagedPageEditor(documentId?: string) {
  revalidatePath("/content/strapi-pages");
  revalidatePath("/content/site-pages");

  if (documentId) {
    revalidatePath(`/content/strapi-pages/${documentId}`);
    revalidatePath(`/content/site-pages/${documentId}`);
  }
}

function revalidatePublishedPage(
  input: ManagedStrapiPageInput,
  previous?: { pageKey: string; slug: string },
) {
  revalidateTag(STRAPI_PAGES_CACHE_TAG, { expire: 0 });
  revalidateTag(STRAPI_PUBLIC_MEDIA_CACHE_TAG, { expire: 0 });
  revalidateTag(strapiPageCacheTag(input.pageKey), { expire: 0 });
  revalidateTag(strapiPageCacheTag(input.slug), { expire: 0 });
  revalidatePath(publicPathFor(input.pageKey, input.slug), "page");
  revalidatePath("/sitemap.xml", "page");

  if (previous) {
    revalidateTag(strapiPageCacheTag(previous.pageKey), { expire: 0 });
    revalidateTag(strapiPageCacheTag(previous.slug), { expire: 0 });
    revalidatePath(publicPathFor(previous.pageKey, previous.slug), "page");
  }
}

export async function saveStrapiPageAction(documentId: string, formData: FormData) {
  const user = await requireContentManagerApiUser();
  const existingPage = await getManagedStrapiPage(documentId);
  if (!existingPage) {
    throw new Error("The page no longer exists in Strapi.");
  }

  const previousIdentity = { pageKey: existingPage.pageKey, slug: existingPage.slug };
  const input = await parsePageInput(formData, previousIdentity);
  await assertPageSlugIsUnique(input, documentId);
  const intent = publicationIntent(formData);
  const note = formString(formData, "changeNote");

  if (intent === "unpublish") {
    await updateManagedStrapiPageWithWorkflow(documentId, input, user, note);
    await transitionManagedStrapiPage(documentId, "unpublish", user, note);
    revalidateManagedPageEditor(documentId);
    revalidatePublishedPage(input, previousIdentity);
    redirect(`/content/site-pages/${documentId}?state=unpublished`);
  }

  await updateManagedStrapiPageWithWorkflow(documentId, input, user, note);
  if (intent === "publish") {
    await transitionManagedStrapiPage(documentId, "publish", user, note);
  }
  revalidateManagedPageEditor(documentId);
  if (intent === "publish") {
    revalidatePublishedPage(input, previousIdentity);
  }
  redirect(`/content/site-pages/${documentId}?state=${intent === "publish" ? "published" : "draft-saved"}`);
}

export async function createStrapiPageAction(formData: FormData) {
  const user = await requireContentManagerApiUser();
  const input = await parsePageInput(formData);
  await assertPageSlugIsUnique(input);
  const status = publicationIntent(formData) === "publish" ? "published" : "draft";
  const note = formString(formData, "changeNote");
  const page = await createManagedStrapiPageWithWorkflow(input, user, note);
  if (status === "published") {
    await transitionManagedStrapiPage(page.documentId, "publish", user, note);
  }
  revalidateManagedPageEditor(page.documentId);
  if (status === "published") {
    revalidatePublishedPage(input);
  }
  redirect(`/content/site-pages/${page.documentId}?state=${status === "published" ? "created-published" : "created-draft"}`);
}

export async function transitionStrapiPageAction(
  documentId: string,
  action: "archive" | "restore",
  formData: FormData,
) {
  const user = await requireContentManagerApiUser();
  const page = await getManagedStrapiPage(documentId);
  if (!page) {
    throw new Error("The page no longer exists in Strapi.");
  }
  const note = formString(formData, "transitionNote");
  await transitionManagedStrapiPage(documentId, action, user, note);
  revalidateManagedPageEditor(documentId);
  revalidatePublishedPage({ ...page, sections: [] }, { pageKey: page.pageKey, slug: page.slug });
  redirect(`/content/site-pages/${documentId}?state=${action}d`);
}

export async function rollbackStrapiPageAction(
  documentId: string,
  revisionDocumentId: string,
  formData: FormData,
) {
  const user = await requireContentManagerApiUser();
  const page = await getManagedStrapiPage(documentId);
  if (!page) {
    throw new Error("The page no longer exists in Strapi.");
  }
  await rollbackManagedStrapiPage(
    documentId,
    revisionDocumentId,
    user,
    formString(formData, "rollbackNote"),
  );
  revalidateManagedPageEditor(documentId);
  redirect(`/content/site-pages/${documentId}?state=rolled-back`);
}

export async function deleteStrapiPageAction(
  documentId: string,
  expectedTitle: string,
  formData: FormData,
) {
  const user = await requireContentManagerApiUser();
  const page = await getManagedStrapiPage(documentId);
  if (!page) {
    throw new Error("The page no longer exists in Strapi.");
  }
  const confirmation = formString(formData, "deleteConfirmation");
  if (page.title !== expectedTitle) {
    throw new Error("The page title changed after this editor was opened. Reload before deleting it.");
  }
  if (confirmation !== page.title) {
    throw new Error("Deletion confirmation must exactly match the current page title.");
  }
  await transitionManagedStrapiPage(
    documentId,
    "delete",
    user,
    formString(formData, "deleteNote") || "Deleted from the AIC page builder.",
    confirmation,
  );
  revalidateManagedPageEditor();
  revalidatePublishedPage({ ...page, sections: [] });
  redirect("/content/site-pages?deleted=1");
}
