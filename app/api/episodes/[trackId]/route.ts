import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { getEpisodeDetail } from "@/lib/podcast-data";

type RouteParams = {
  trackId: string;
};

type RouteContext = {
  params: Promise<RouteParams>;
};

function toPublicEpisodeDetail(detail: NonNullable<Awaited<ReturnType<typeof getEpisodeDetail>>>) {
  return {
    episode: {
      trackId: detail.episode.trackId,
      title: detail.episode.title,
      publishDate: detail.episode.publishDate,
      album: detail.episode.album,
      category: detail.episode.category,
      detail: detail.episode.detail,
      audioUrl: detail.episode.audioUrl,
    },
    intelligence: detail.intelligence
      ? {
          episodeType: detail.intelligence.episodeType,
          executiveSummary: detail.intelligence.executiveSummary,
          longSummary: detail.intelligence.longSummary,
          mainTopics: detail.intelligence.mainTopics,
          searchKeywords: detail.intelligence.searchKeywords,
          transcriptTruncated: detail.intelligence.transcriptTruncated,
        }
      : null,
    transcript: detail.transcript,
    intelligenceItems: detail.intelligenceItems.map((item) => ({
      id: item.id,
      itemType: item.itemType,
      label: item.label,
      summary: item.summary,
      speakers: item.speakers,
      sourceTimes: item.sourceTimes,
    })),
  };
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { trackId } = await params;
  const { userId } = await auth();

  if (!trackId) {
    return NextResponse.json({ error: "track_id is required" }, { status: 400 });
  }

  const detail = await getEpisodeDetail(trackId);

  if (!detail) {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }

  return NextResponse.json(userId ? detail : toPublicEpisodeDetail(detail));
}
