import { NextRequest, NextResponse } from "next/server";

import { getEpisodeDetail } from "@/lib/podcast-data";
import { getInternalReadApiUser } from "@/lib/rbac";

type RouteParams = {
  trackId: string;
};

type RouteContext = {
  params: Promise<RouteParams>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const appUser = await getInternalReadApiUser();
  if (!appUser) {
    return NextResponse.json(
      { error: "This role cannot access internal episode details." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const { trackId } = await params;

  if (!trackId) {
    return NextResponse.json({ error: "track_id is required" }, { status: 400 });
  }

  const detail = await getEpisodeDetail(trackId);

  if (!detail) {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
