"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";

import {
  createManagedStrapiPage,
  getManagedStrapiPage,
  listManagedStrapiPages,
  unpublishManagedStrapiPage,
  updateManagedStrapiPage,
  type ManagedStrapiPageInput,
} from "@/lib/strapi-management";
import {
  assertAllowedPageSlug,
  assertUniquePageSlug,
  immutablePageKey,
} from "@/lib/cms-page-validation";
import { requireContentManagerApiUser } from "@/lib/rbac";
import { STRAPI_PAGES_CACHE_TAG, strapiPageCacheTag } from "@/lib/strapi";
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
  const pages = await listManagedStrapiPages();
  assertUniquePageSlug({ slug: input.slug, pages, excludeDocumentId });
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
  revalidateTag(STRAPI_PAGES_CACHE_TAG, "max");
  revalidateTag(strapiPageCacheTag(input.pageKey), "max");
  revalidateTag(strapiPageCacheTag(input.slug), "max");
  revalidatePath(publicPathFor(input.pageKey, input.slug), "page");

  if (previous) {
    revalidateTag(strapiPageCacheTag(previous.pageKey), "max");
    revalidateTag(strapiPageCacheTag(previous.slug), "max");
    revalidatePath(publicPathFor(previous.pageKey, previous.slug), "page");
  }
}

export async function saveStrapiPageAction(documentId: string, formData: FormData) {
  await requireContentManagerApiUser();
  const existingPage = await getManagedStrapiPage(documentId);
  if (!existingPage) {
    throw new Error("The page no longer exists in Strapi.");
  }

  const previousIdentity = { pageKey: existingPage.pageKey, slug: existingPage.slug };
  const input = await parsePageInput(formData, previousIdentity);
  await assertPageSlugIsUnique(input, documentId);
  const intent = publicationIntent(formData);

  if (intent === "unpublish") {
    await updateManagedStrapiPage(documentId, input, "draft");
    await unpublishManagedStrapiPage(documentId);
    revalidateManagedPageEditor(documentId);
    revalidatePublishedPage(input, previousIdentity);
    redirect(`/content/site-pages/${documentId}?state=unpublished`);
  }

  await updateManagedStrapiPage(documentId, input, intent === "publish" ? "published" : "draft");
  revalidateManagedPageEditor(documentId);
  if (intent === "publish") {
    revalidatePublishedPage(input, previousIdentity);
  }
  redirect(`/content/site-pages/${documentId}?state=${intent === "publish" ? "published" : "draft-saved"}`);
}

export async function createStrapiPageAction(formData: FormData) {
  await requireContentManagerApiUser();
  const input = await parsePageInput(formData);
  await assertPageSlugIsUnique(input);
  const status = publicationIntent(formData) === "publish" ? "published" : "draft";
  const page = await createManagedStrapiPage(input, status);
  revalidateManagedPageEditor(page.documentId);
  if (status === "published") {
    revalidatePublishedPage(input);
  }
  redirect(`/content/site-pages/${page.documentId}?state=${status === "published" ? "created-published" : "created-draft"}`);
}
