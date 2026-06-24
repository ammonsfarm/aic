import { NextRequest, NextResponse } from "next/server";

import { getUserRagHistory, type RagInteractionScope } from "@/lib/rag-interactions";
import { requireSignedInAppUser } from "@/lib/rbac";

function parseScope(value: string | null): RagInteractionScope | undefined {
  if (value === "research" || value === "archive" || value === "episode") {
    return value;
  }

  return undefined;
}

function parseLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 10;
  }

  return Math.max(1, Math.min(Math.trunc(parsed), 50));
}

export async function GET(request: NextRequest) {
  const user = await requireSignedInAppUser();
  const params = request.nextUrl.searchParams;
  const history = await getUserRagHistory({
    user,
    scope: parseScope(params.get("scope")),
    trackId: params.get("trackId")?.trim() || undefined,
    limit: parseLimit(params.get("limit")),
  });

  return NextResponse.json({ history });
}
