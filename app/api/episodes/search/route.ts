import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { getEpisodeArchiveRows } from "@/lib/podcast-insights";
import { searchEpisodesByText, searchEpisodesWithVectorFallback } from "@/lib/podcast-data";
import type { EpisodeSearchScope } from "@/lib/podcast-data";

type EpisodeSearchResponse = {
  query: string;
  results: Awaited<ReturnType<typeof searchEpisodesByText>>;
  total: number;
  mode: "text" | "hybrid";
};

function parseTopK(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 40;
  }

  const intValue = Math.trunc(parsed);
  if (intValue <= 0) {
    return 40;
  }

  return Math.min(intValue, 80);
}

function parseBoolean(value: string | null): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseScope(value: string | null): EpisodeSearchScope {
  if (value === "title" || value === "passage" || value === "guest" || value === "interview" || value === "theme") {
    return value;
  }

  return "all";
}

function parseMode(value: string | null): "text" | "hybrid" {
  if (value?.trim().toLowerCase() === "text") {
    return "text";
  }

  return "hybrid";
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  await auth.protect();
  const rawQuery = params.get("q")?.trim() ?? "";
  const mode = parseMode(params.get("mode"));
  const topK = parseTopK(params.get("top_k"));
  const useTextOnly = parseBoolean(params.get("text_only"));
  const trackId = params.get("track_id")?.trim() || undefined;
  const scope = parseScope(params.get("scope"));

  const options = { limit: topK, trackId, scope } as {
    limit: number;
    trackId?: string;
    scope: EpisodeSearchScope;
  };

  let results;
  if (!rawQuery) {
    results = await getEpisodeArchiveRows({ query: "", limit: topK + 20, scope });
  } else if (useTextOnly || mode === "text") {
    results = await searchEpisodesByText(rawQuery, options);
  } else {
    results = await searchEpisodesWithVectorFallback(rawQuery, options);
  }

  const response: EpisodeSearchResponse = {
    query: rawQuery,
    results,
    total: results.length,
    mode: useTextOnly || mode === "text" ? "text" : "hybrid",
  };

  return NextResponse.json(response);
}
