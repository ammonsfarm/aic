import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { getEpisodeDetail } from "@/lib/podcast-data";

type RouteParams = {
  trackId: string;
};

type RouteContext = {
  params: Promise<RouteParams>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { trackId } = await params;
  await auth.protect();

  if (!trackId) {
    return NextResponse.json({ error: "track_id is required" }, { status: 400 });
  }

  const detail = await getEpisodeDetail(trackId);

  if (!detail) {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
