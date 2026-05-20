import "server-only";
import type { NextRequest } from "next/server";

type RateEntry = {
  windowStart: number;
  count: number;
};

declare global {
  var aicRagRateMap: Map<string, RateEntry> | undefined;
}

const PUBLIC_MAX_BODY_BYTES = 16_000;
const PUBLIC_MAX_QUESTION_CHARS = 1_800;
const PRIVATE_MAX_QUESTION_CHARS = 8_000;
const RATE_WINDOW_MS = 60_000;

function getRateMap() {
  if (!globalThis.aicRagRateMap) {
    globalThis.aicRagRateMap = new Map();
  }

  return globalThis.aicRagRateMap;
}

function getClientKey(request: NextRequest, userId: string | null) {
  if (userId) {
    return `user:${userId}`;
  }

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();

  return `ip:${cfIp || forwardedFor || realIp || "unknown"}`;
}

export function validateChatRequestBody(request: NextRequest) {
  const rawLength = request.headers.get("content-length");
  const contentLength = rawLength ? Number(rawLength) : 0;

  if (Number.isFinite(contentLength) && contentLength > PUBLIC_MAX_BODY_BYTES) {
    return `Request body is too large. Keep chat requests under ${PUBLIC_MAX_BODY_BYTES} bytes.`;
  }

  return "";
}

export function validateQuestionLength(question: string, isSignedIn: boolean) {
  const maxLength = isSignedIn ? PRIVATE_MAX_QUESTION_CHARS : PUBLIC_MAX_QUESTION_CHARS;

  if (question.length > maxLength) {
    return `Question is too long. Keep it under ${maxLength} characters.`;
  }

  return "";
}

export function checkChatRateLimit(request: NextRequest, userId: string | null) {
  const now = Date.now();
  const key = getClientKey(request, userId);
  const limit = userId ? 60 : 10;
  const map = getRateMap();
  const existing = map.get(key);

  if (!existing || now - existing.windowStart > RATE_WINDOW_MS) {
    map.set(key, { windowStart: now, count: 1 });
    return { ok: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;

  if (existing.count > limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - existing.windowStart)) / 1000)),
    };
  }

  return { ok: true, retryAfterSeconds: 0 };
}

export function resolveRequestedProvider(provider: string | undefined, isSignedIn: boolean) {
  if (isSignedIn || process.env.ALLOW_PUBLIC_RAG_PROVIDER_SELECTION === "true") {
    return provider;
  }

  return undefined;
}

export function publicChatError(error: unknown) {
  if (!(error instanceof Error)) {
    return "Chat request failed.";
  }

  if (error.message.includes("OPENAI_API_KEY") || error.message.includes("SILO_TEMP_KEY")) {
    return "Chat service is not fully configured.";
  }

  if (error.message.includes("Embedding request failed")) {
    return "Search embedding failed. Try again in a moment.";
  }

  if (error.message.includes("chat request failed")) {
    return "The answer service did not complete the request.";
  }

  return "Chat request failed.";
}
