import { isPublicEpisodeTrackId, PUBLIC_EPISODE_AUDIO_CACHE_CONTROL, publicEpisodeAudioResponse } from "@/lib/episode-audio";
import { getPublishedEpisodeByTrackIdResult } from "@/lib/strapi-structured-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ trackId: string }> };

async function serve(request: Request, { params }: Context) {
  const { trackId } = await params;
  if (!isPublicEpisodeTrackId(trackId)) return new Response(null, { status: 404 });
  const episode = await getPublishedEpisodeByTrackIdResult(trackId);
  if (episode.status === "unavailable") {
    return new Response(null, {
      status: 503,
      headers: {
        "Cache-Control": PUBLIC_EPISODE_AUDIO_CACHE_CONTROL,
        "Retry-After": "60",
      },
    });
  }
  if (episode.status === "not-found") return new Response(null, { status: 404 });
  return publicEpisodeAudioResponse(request, trackId);
}

export const GET = serve;
export const HEAD = serve;
