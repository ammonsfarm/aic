import { NextRequest, NextResponse } from "next/server";

import { buildPodcastCsvReport, parsePodcastExportReport } from "@/lib/podcast-export";
import { isForbiddenError, requireAdminApiUser } from "@/lib/rbac";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireAdminApiUser();
    const report = parsePodcastExportReport(request.nextUrl.searchParams.get("report"));
    if (!report) {
      return NextResponse.json({ error: "Unsupported export report." }, { status: 400 });
    }

    const startDate = request.nextUrl.searchParams.get("startDate") ?? "";
    const endDate = request.nextUrl.searchParams.get("endDate") ?? "";
    const csv = await buildPodcastCsvReport({ report, startDate, endDate });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="aic-${report}-${startDate}-to-${endDate}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Administrator role is required." }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : "Could not generate the CSV export.";
    return NextResponse.json({ error: message }, { status: /valid export date range/i.test(message) ? 400 : 500 });
  }
}
