import { NextRequest, NextResponse } from "next/server";

import { reconcilePodtracEpisode } from "@/lib/admin-operations";
import { isForbiddenError, requireAdminApiUser } from "@/lib/rbac";

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminApiUser();
    const payload = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      podtracEpisodeId?: unknown;
      trackId?: unknown;
      note?: unknown;
    };
    const action = payload.action === "match" || payload.action === "unmatch" ? payload.action : null;
    if (!action) {
      return NextResponse.json({ error: "A Podtrac reconciliation action is required." }, { status: 400 });
    }
    const note = typeof payload.note === "string" ? payload.note.trim() : "";
    if (!note) {
      return NextResponse.json({ error: "An audit note is required before changing a Podtrac match." }, { status: 400 });
    }
    const trackId = typeof payload.trackId === "string" ? payload.trackId.trim() : null;
    if (action === "match" && !trackId) {
      return NextResponse.json({ error: "An archive episode candidate is required for a manual Podtrac match." }, { status: 400 });
    }
    if (action === "unmatch" && trackId) {
      return NextResponse.json({ error: "An unmatch request cannot assign an archive episode candidate." }, { status: 400 });
    }

    const result = await reconcilePodtracEpisode({
      action,
      podtracEpisodeId: typeof payload.podtracEpisodeId === "string" ? payload.podtracEpisodeId : "",
      trackId,
      note,
      actorEmail: admin.email,
    });
    return NextResponse.json({ reconciliation: result });
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Administrator role is required." }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : "Could not reconcile the Podtrac episode.";
    const status = /not found|required|cannot assign/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
