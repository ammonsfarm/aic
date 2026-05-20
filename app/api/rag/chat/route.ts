import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { runRagChat } from "@/lib/rag-chat";
import {
  checkChatRateLimit,
  publicChatError,
  resolveRequestedProvider,
  validateChatRequestBody,
  validateQuestionLength,
} from "@/lib/rag-route-guards";

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

  const { userId } = await auth.protect();
  const rateLimit = checkChatRateLimit(request, userId);
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

  const questionError = validateQuestionLength(question, Boolean(userId));
  if (questionError) {
    return NextResponse.json({ error: questionError }, { status: 400 });
  }

  try {
    const result = await runRagChat({
      query: question,
      trackId: payload.trackId?.trim() || undefined,
      topK: Number.isFinite(topK) ? topK : 10,
      provider: resolveRequestedProvider(payload.provider, true),
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("rag-chat request failed", error);
    return NextResponse.json({ error: publicChatError(error) }, { status: 503 });
  }
}
