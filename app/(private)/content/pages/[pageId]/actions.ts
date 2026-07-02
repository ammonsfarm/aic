"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createContentPageDraftRevision } from "@/lib/content-pages";
import { requireContentManagerApiUser } from "@/lib/rbac";

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function savePageDraftAction(formData: FormData) {
  const user = await requireContentManagerApiUser();
  const pageId = Number(textValue(formData, "pageId"));

  if (!Number.isInteger(pageId) || pageId <= 0) {
    throw new Error("A valid page id is required.");
  }

  const revision = await createContentPageDraftRevision({
    pageId,
    title: textValue(formData, "title"),
    seoTitle: textValue(formData, "seoTitle"),
    seoDescription: textValue(formData, "seoDescription"),
    heroTitle: textValue(formData, "heroTitle"),
    heroBody: textValue(formData, "heroBody"),
    changeNote: textValue(formData, "changeNote"),
    createdBy: user.email,
  });

  revalidatePath(`/content/pages/${pageId}`);
  revalidatePath("/content/pages");
  redirect(`/content/pages/${pageId}?saved=${revision.revisionNumber}`);
}
