import { isPublicEpisodeTrackId, publicEpisodeAudioResponse } from "@/lib/episode-audio";
import { getPublishedEpisodeByTrackId } from "@/lib/strapi-structured-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ trackId: string }> };

async function serve(request: Request, { params }: Context) {
  const { trackId } = await params;
  if (!isPublicEpisodeTrackId(trackId)) return new Response(null, { status: 404 });
  const episode = await getPublishedEpisodeByTrackId(trackId);
  if (!episode) return new Response(null, { status: 404 });
  return publicEpisodeAudioResponse(request, trackId);
}

export const GET = serve;
export const HEAD = serve;
