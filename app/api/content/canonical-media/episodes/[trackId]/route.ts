import { NextRequest, NextResponse } from "next/server";

import { getCanonicalEpisodeMedia } from "@/lib/canonical-episode-media";
import { episodeAudioResponse } from "@/lib/episode-audio";
import {
  isForbiddenError,
  requireContentManagerApiUser,
} from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ trackId: string }> };
const PRIVATE_PREVIEW_CACHE_CONTROL = "private, no-store, max-age=0";

async function serve(request: NextRequest, { params }: Context) {
  try {
    await requireContentManagerApiUser();
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Content Manager role is required." }, { status: 403 });
    }
    throw error;
  }

  const { trackId } = await params;
  const item = await getCanonicalEpisodeMedia(trackId);
  if (!item) return new NextResponse(null, { status: 404 });
  return episodeAudioResponse(request, item.trackId, PRIVATE_PREVIEW_CACHE_CONTROL);
}

export const GET = serve;
export const HEAD = serve;
