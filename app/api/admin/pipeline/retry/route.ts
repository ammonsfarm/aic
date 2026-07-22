import { NextRequest, NextResponse } from "next/server";

import { parseRetryableStage, queuePipelineRetry } from "@/lib/admin-operations";
import { isForbiddenError, requireAdminApiUser } from "@/lib/rbac";

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminApiUser();
    const payload = (await request.json().catch(() => ({}))) as {
      stage?: unknown;
      sourceRunId?: unknown;
      reason?: unknown;
    };
    const stage = parseRetryableStage(payload.stage);
    if (!stage) {
      return NextResponse.json({ error: "Unsupported pipeline stage." }, { status: 400 });
    }

    const retry = await queuePipelineRetry({
      stage,
      sourceRunId: typeof payload.sourceRunId === "string" ? payload.sourceRunId : null,
      reason: typeof payload.reason === "string" ? payload.reason : "",
      actorEmail: admin.email,
    });
    return NextResponse.json({ retry }, { status: 202 });
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Administrator role is required." }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : "Could not queue the retry request.";
    const status = /already queued or running/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
