import { NextRequest, NextResponse } from "next/server";

import { generateReadingPlan, resolveReadingPlanBookNames, type ReadingPlanScope } from "@/lib/reading-plan";
import {
  checkChatRateLimit,
  publicChatError,
  resolveRequestedProvider,
  validateChatRequestBody,
} from "@/lib/rag-route-guards";
import { getGenerationApiUser } from "@/lib/rbac";

export const runtime = "nodejs";
export const maxDuration = 90;

type ReadingPlanRequest = {
  durationDays?: number;
  scope?: string;
  topic?: string;
  translationId?: string;
  provider?: string;
  selectedBooks?: unknown;
};

const allowedScopes = new Set<ReadingPlanScope>([
  "whole-bible",
  "old-new",
  "new-testament",
  "gospels",
  "epistles",
  "wisdom",
  "specific-books",
  "topic",
  "custom",
]);

const allowedDurations = new Set([30, 60, 90, 180, 365]);

function normalizeScope(value: unknown): ReadingPlanScope | null {
  if (typeof value !== "string") {
    return "whole-bible";
  }

  return allowedScopes.has(value as ReadingPlanScope) ? (value as ReadingPlanScope) : null;
}

function normalizeDuration(value: unknown) {
  const duration = Number(value);

  if (!Number.isFinite(duration)) {
    return 30;
  }

  return allowedDurations.has(duration) ? duration : null;
}

function normalizeSelectedBooks(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((book) => (typeof book === "string" ? book.trim() : ""))
    .filter(Boolean)
    .slice(0, 66);
}

export async function POST(request: NextRequest) {
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
      { error: "Too many reading-plan requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const payload = (await request.json().catch(() => ({}))) as ReadingPlanRequest;
  const scope = normalizeScope(payload.scope);
  const durationDays = normalizeDuration(payload.durationDays);
  const selectedBooks = normalizeSelectedBooks(payload.selectedBooks);
  const resolvedBookNames = resolveReadingPlanBookNames(selectedBooks);

  if (!scope) {
    return NextResponse.json({ error: "Unsupported reading-plan scope." }, { status: 400 });
  }

  if (!durationDays) {
    return NextResponse.json({ error: "Unsupported reading-plan duration." }, { status: 400 });
  }

  if (scope === "specific-books" && resolvedBookNames.length === 0) {
    return NextResponse.json({ error: "Choose at least one Bible book." }, { status: 400 });
  }

  const topic = (payload.topic ?? "").toString().trim();
  if (topic.length > 180) {
    return NextResponse.json({ error: "Topic is too long. Keep it under 180 characters." }, { status: 400 });
  }

  const translationId = (payload.translationId ?? "").toString().trim();
  if (translationId.length > 80) {
    return NextResponse.json({ error: "Translation id is too long." }, { status: 400 });
  }

  try {
    const result = await generateReadingPlan({
      durationDays,
      scope,
      topic,
      translationId: translationId || undefined,
      provider: resolveRequestedProvider(payload.provider, true),
      selectedBooks: resolvedBookNames,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("reading-plan generation failed", error);
    return NextResponse.json({ error: publicChatError(error) }, { status: 503 });
  }
}
