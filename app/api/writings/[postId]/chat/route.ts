import { NextRequest, NextResponse } from "next/server";

import { recordRagInteraction } from "@/lib/rag-interactions";
import { runPastorWoodWritingChat } from "@/lib/rag-chat";
import {
  checkChatRateLimit,
  publicChatError,
  resolveRequestedProvider,
  validateChatRequestBody,
  validateQuestionLength,
} from "@/lib/rag-route-guards";
import { getGenerationApiUser } from "@/lib/rbac";

type RouteParams = {
  postId: string;
};

type RouteContext = {
  params: Promise<RouteParams>;
};

type ChatRequest = {
  question?: string;
  topK?: number;
  provider?: string;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { postId } = await params;
  const bodyError = validateChatRequestBody(request);
  if (bodyError) {
    return NextResponse.json({ error: bodyError }, { status: 413 });
  }

  const appUser = await getGenerationApiUser();
  if (!appUser) {
    return NextResponse.json({ error: "This role cannot run generation requests." }, { status: 403 });
  }
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

  const boundedTopK = Math.max(2, Math.min(Number.isFinite(topK) ? Math.trunc(topK) : 8, 12));
  const startedAt = Date.now();
  const historyTrackId = `pastorwood:${postId}`;

  try {
    const result = await runPastorWoodWritingChat({
      postId,
      query: question,
      topK: boundedTopK,
      provider: resolveRequestedProvider(payload.provider, true),
    });
    const interaction = await recordRagInteraction({
      user: appUser,
      scope: "writing",
      trackId: historyTrackId,
      question,
      topK: boundedTopK,
      result,
      status: "completed",
      durationMs: Date.now() - startedAt,
    }).catch((error) => {
      console.error("writing-rag-chat history insert failed", error);
      return null;
    });

    const publicResult = { ...result };
    delete publicResult.usageJson;
    return NextResponse.json({ ...publicResult, interactionId: interaction?.id ?? "" });
  } catch (error) {
    const publicError = publicChatError(error);
    await recordRagInteraction({
      user: appUser,
      scope: "writing",
      trackId: historyTrackId,
      question,
      topK: boundedTopK,
      status: "failed",
      error: publicError,
      durationMs: Date.now() - startedAt,
    }).catch((insertError) => {
      console.error("writing-rag-chat failure history insert failed", insertError);
    });
    console.error("writing-rag-chat request failed", error);
    return NextResponse.json({ error: publicError }, { status: 503 });
  }
}
