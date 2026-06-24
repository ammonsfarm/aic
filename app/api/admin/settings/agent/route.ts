import { NextRequest, NextResponse } from "next/server";

import { getAgentSettingsView, saveAgentSettings, type AgentProvider } from "@/lib/agent-settings";
import { isForbiddenError, requireAdminApiUser } from "@/lib/rbac";

type AgentSettingsPayload = {
  provider?: unknown;
  model?: unknown;
  systemApiKey?: unknown;
  clearSystemApiKey?: unknown;
};

function normalizeProvider(value: unknown): AgentProvider | null {
  return value === "silo" || value === "openai" ? value : null;
}

export async function GET() {
  try {
    await requireAdminApiUser();
    return NextResponse.json({ settings: await getAgentSettingsView() });
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Administrator role is required." }, { status: 403 });
    }

    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminApiUser();
    const payload = (await request.json().catch(() => ({}))) as AgentSettingsPayload;
    const provider = normalizeProvider(payload.provider);
    const model = typeof payload.model === "string" ? payload.model.trim() : "";
    const systemApiKey = typeof payload.systemApiKey === "string" ? payload.systemApiKey : "";
    const clearSystemApiKey = payload.clearSystemApiKey === true;

    if (!provider) {
      return NextResponse.json({ error: "Choose a supported provider." }, { status: 400 });
    }

    const settings = await saveAgentSettings({
      provider,
      model,
      systemApiKey,
      clearSystemApiKey,
      updatedBy: admin.email,
    });

    return NextResponse.json({ settings });
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Administrator role is required." }, { status: 403 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Agent settings update failed." }, { status: 400 });
  }
}
