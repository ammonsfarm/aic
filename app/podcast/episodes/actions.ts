"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdminApiUser } from "@/lib/rbac";
import { queueEpisodeReprocessByTrackId } from "@/lib/strapi-structured-management";

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function safeReturnTo(value: string, trackId: string) {
  const fallback = `/podcast/episodes?trackId=${encodeURIComponent(trackId)}`;
  const episodeDetailPath = `/console/episodes/${encodeURIComponent(trackId)}`;
  const legacyEpisodeDetailPath = `/episodes/${encodeURIComponent(trackId)}`;
  try {
    const url = new URL(value, "https://pastorwood.invalid");
    if (url.origin !== "https://pastorwood.invalid") {
      return fallback;
    }
    if (url.pathname === episodeDetailPath) {
      return episodeDetailPath;
    }
    if (url.pathname === legacyEpisodeDetailPath) {
      return episodeDetailPath;
    }
    if (url.pathname !== "/podcast/episodes") {
      return fallback;
    }
    url.searchParams.set("trackId", trackId);
    return `${url.pathname}?${url.searchParams.toString()}`;
  } catch {
    return fallback;
  }
}

function withOutcome(returnTo: string, key: "reprocessQueued" | "reprocessError", value: string) {
  const url = new URL(returnTo, "https://pastorwood.invalid");
  url.searchParams.delete("reprocessQueued");
  url.searchParams.delete("reprocessError");
  url.searchParams.set(key, value.slice(0, 300));
  return `${url.pathname}?${url.searchParams.toString()}#episode-reprocess`;
}

function publicReprocessError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "";
  if (message.includes("already queued or running")) {
    return "Episode processing is already queued or running.";
  }
  if (message.includes("No Strapi episode matches Track ID")) {
    return "No matching Strapi episode exists for this Track ID.";
  }
  if (message.includes("invalid permanent Track ID")) {
    return "This episode has an invalid permanent Track ID.";
  }
  if (message.includes("reprocessing reason")) {
    return "A valid reprocessing reason is required.";
  }
  if (message.includes("no editorial revision")) {
    return "This episode has no editorial revision to process.";
  }
  return "The episode could not be queued for reprocessing. Review the processing status and try again.";
}

export async function queueEpisodeReprocessAction(
  trackId: string,
  returnTo: string,
  formData: FormData,
) {
  const user = await requireAdminApiUser();
  const safeTarget = safeReturnTo(returnTo, trackId);
  if (formString(formData, "confirmReprocess") !== "confirmed") {
    redirect(withOutcome(safeTarget, "reprocessError", "Confirm the full episode rebuild before queuing it."));
  }

  try {
    await queueEpisodeReprocessByTrackId(trackId, user, formString(formData, "reprocessNote"));
  } catch (cause) {
    redirect(withOutcome(safeTarget, "reprocessError", publicReprocessError(cause)));
  }

  revalidatePath("/podcast/episodes");
  revalidatePath(`/console/episodes/${encodeURIComponent(trackId)}`);
  revalidatePath("/content/podcast");
  redirect(withOutcome(safeTarget, "reprocessQueued", "1"));
}
