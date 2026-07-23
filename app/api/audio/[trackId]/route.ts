import { episodeAudioResponse, isPublicEpisodeTrackId } from "@/lib/episode-audio";
import { getInternalReadApiUser } from "@/lib/rbac";

export const runtime = "nodejs";

type Context = { params: Promise<{ trackId: string }> };

export async function GET(request: Request, { params }: Context) {
  const appUser = await getInternalReadApiUser();
  if (!appUser) {
    return Response.json(
      { error: "This role cannot access internal episode audio." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const { trackId } = await params;
  if (!isPublicEpisodeTrackId(trackId)) return new Response(null, { status: 400 });
  return episodeAudioResponse(request, trackId, "private, max-age=3600");
}

export async function HEAD(request: Request, context: Context) {
  return GET(request, context);
}
