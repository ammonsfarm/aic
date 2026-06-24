import { NextRequest, NextResponse } from "next/server";

import { getRagRetrievalSettings } from "@/lib/agent-settings";
import { recordRagInteraction } from "@/lib/rag-interactions";
import { runRagChat } from "@/lib/rag-chat";
import {
  checkChatRateLimit,
  publicChatError,
  resolveRequestedProvider,
  validateChatRequestBody,
  validateQuestionLength,
} from "@/lib/rag-route-guards";
import { requireSignedInAppUser } from "@/lib/rbac";

type ChatRequest = {
  question?: string;
  topK?: number;
  trackId?: string;
  provider?: string;
};

export async function POST(request: NextRequest) {
  const bodyError = validateChatRequestBody(request);
  if (bodyError) {
    return NextResponse.json({ error: bodyError }, { status: 413 });
  }

  const appUser = await requireSignedInAppUser();
  const rateLimit = checkChatRateLimit(request, appUser.clerkUserId);
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many chat requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const payload = (await request.json().catch(() => ({}))) as ChatRequest;
  const question = (payload.question ?? "").toString().trim();
  const topK = Number(payload.topK);

  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const questionError = validateQuestionLength(question, true);
  if (questionError) {
    return NextResponse.json({ error: questionError }, { status: 400 });
  }

  const retrievalSettings = await getRagRetrievalSettings();
  const requestedTopK = Number.isFinite(topK) ? Math.trunc(topK) : retrievalSettings.archiveTopK;
  const boundedTopK = Math.max(1, Math.min(requestedTopK, retrievalSettings.archiveTopK));
  const trackId = payload.trackId?.trim() || undefined;
  const startedAt = Date.now();

  try {
    const result = await runRagChat({
      query: question,
      trackId,
      topK: boundedTopK,
      retrievalSettings,
      provider: resolveRequestedProvider(payload.provider, true),
    });
    const interaction = await recordRagInteraction({
      user: appUser,
      scope: "archive",
      trackId,
      question,
      topK: boundedTopK,
      result,
      status: "completed",
      durationMs: Date.now() - startedAt,
    }).catch((error) => {
      console.error("rag-chat history insert failed", error);
      return null;
    });

    const publicResult = { ...result };
    delete publicResult.usageJson;
    return NextResponse.json({ ...publicResult, interactionId: interaction?.id ?? "" });
  } catch (error) {
    const publicError = publicChatError(error);
    await recordRagInteraction({
      user: appUser,
      scope: "archive",
      trackId,
      question,
      topK: boundedTopK,
      status: "failed",
      error: publicError,
      durationMs: Date.now() - startedAt,
    }).catch((insertError) => {
      console.error("rag-chat failure history insert failed", insertError);
    });
    console.error("rag-chat request failed", error);
    return NextResponse.json({ error: publicError }, { status: 503 });
  }
}
