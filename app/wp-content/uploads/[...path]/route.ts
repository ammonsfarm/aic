import { NextResponse } from "next/server";

import { findPublicMediaEntry } from "@/lib/public-media";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const entry = findPublicMediaEntry(path || []);
  if (!entry) return new Response("Not found", { status: 404 });
  return NextResponse.redirect(new URL(entry.publicPath, request.url), 308);
}

export const HEAD = GET;
