import { NextRequest, NextResponse } from "next/server";

import { reconcilePodtracEpisode } from "@/lib/admin-operations";
import { isForbiddenError, requireAdminApiUser } from "@/lib/rbac";

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminApiUser();
    const payload = (await request.json().catch(() => ({}))) as {
      podtracEpisodeId?: unknown;
      trackId?: unknown;
      note?: unknown;
    };

    const result = await reconcilePodtracEpisode({
      podtracEpisodeId: typeof payload.podtracEpisodeId === "string" ? payload.podtracEpisodeId : "",
      trackId: typeof payload.trackId === "string" ? payload.trackId : null,
      note: typeof payload.note === "string" ? payload.note : "",
      actorEmail: admin.email,
    });
    return NextResponse.json({ reconciliation: result });
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Administrator role is required." }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : "Could not reconcile the Podtrac episode.";
    const status = /not found|required/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
