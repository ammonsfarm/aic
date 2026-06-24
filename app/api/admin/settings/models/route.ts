import { NextRequest, NextResponse } from "next/server";

import { getSupportedAgentModels } from "@/lib/agent-models";
import { isForbiddenError, requireAdminApiUser } from "@/lib/rbac";

function parseProvider(value: string | null): "silo" | "openai" {
  return value === "openai" ? "openai" : "silo";
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminApiUser();
    const provider = parseProvider(request.nextUrl.searchParams.get("provider"));
    return NextResponse.json(await getSupportedAgentModels(provider));
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Administrator role is required." }, { status: 403 });
    }

    throw error;
  }
}
