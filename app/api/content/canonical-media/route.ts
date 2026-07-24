import { NextRequest, NextResponse } from "next/server";

import { listCanonicalEpisodeMedia } from "@/lib/canonical-episode-media";
import {
  isForbiddenError,
  requireContentManagerApiUser,
} from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function positiveInteger(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  try {
    await requireContentManagerApiUser();
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Content Manager role is required." }, { status: 403 });
    }
    throw error;
  }

  const result = await listCanonicalEpisodeMedia({
    page: positiveInteger(request.nextUrl.searchParams.get("page"), 1),
    pageSize: positiveInteger(request.nextUrl.searchParams.get("pageSize"), 20),
    search: request.nextUrl.searchParams.get("search") || "",
  });

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
