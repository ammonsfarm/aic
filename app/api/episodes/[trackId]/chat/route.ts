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

type RouteParams = {
  trackId: string;
};

type RouteContext = {
  params: Promise<RouteParams>;
};

type ChatRequest = {
  question?: string;
  topK?: number;
  provider?: string;
};

type RagChatResult = Awaited<ReturnType<typeof runRagChat>>;

function cleanPublicSourceText(value: string) {
  return value
    .split(/\r?\n/)
    .filter((line) => !/^(Episode:|Track ID:|Publish Date:|Time Range:)\s*/i.test(line.trim()))
    .join("\n")
    .trim();
}

function toPublicChatResult(result: RagChatResult) {
  return {
    ...result,
    provider: "",
    model: "",
    sources: result.sources.map((source) => ({
      ...source,
      snippet: cleanPublicSourceText(source.snippet),
      text: cleanPublicSourceText(source.text),
      score: 0,
      vectorModel: "",
    })),
  };
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { trackId } = await params;
  const bodyError = validateChatRequestBody(request);
  if (bodyError) {
    return NextResponse.json({ error: bodyError }, { status: 413 });
  }

  const { userId } = await auth();
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
      trackId,
      topK: Number.isFinite(topK) ? topK : 10,
      provider: resolveRequestedProvider(payload.provider, Boolean(userId)),
    });

    return NextResponse.json(userId ? result : toPublicChatResult(result));
  } catch (error) {
    console.error("episode-rag-chat request failed", error);
    return NextResponse.json({ error: publicChatError(error) }, { status: 503 });
  }
}
