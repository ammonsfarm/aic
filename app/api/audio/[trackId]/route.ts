import { auth } from "@clerk/nextjs/server";

import { episodeAudioResponse, isPublicEpisodeTrackId } from "@/lib/episode-audio";

export const runtime = "nodejs";

type Context = { params: Promise<{ trackId: string }> };

export async function GET(request: Request, { params }: Context) {
  await auth.protect();
  const { trackId } = await params;
  if (!isPublicEpisodeTrackId(trackId)) return new Response(null, { status: 400 });
  return episodeAudioResponse(request, trackId, "private, max-age=3600");
}

export async function HEAD(request: Request, context: Context) {
  return GET(request, context);
}
