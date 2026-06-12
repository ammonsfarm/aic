import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import { buildReadingPlanExportHtml, readingPlanExportFilename } from "@/lib/reading-plan-export";
import type { ReadingPlanResult } from "@/lib/reading-plan";
import { checkChatRateLimit, publicChatError } from "@/lib/rag-route-guards";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_EXPORT_BODY_BYTES = 1_000_000;
const MAX_EXPORT_DAYS = 400;

type ExportRequest = {
  plan?: unknown;
};

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function stringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => text(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function normalizeCoverageLabel(value: unknown): ReadingPlanResult["coverageLabel"] {
  if (value === "direct" || value === "thematic" || value === "style-guided") {
    return value;
  }

  return "style-guided";
}

function normalizePlan(value: unknown): ReadingPlanResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<ReadingPlanResult>;
  const outline = Array.isArray(raw.outline) ? raw.outline.slice(0, MAX_EXPORT_DAYS) : [];
  const generatedDays = Array.isArray(raw.generatedDays) ? raw.generatedDays.slice(0, 10) : [];
  const sources = Array.isArray(raw.sources) ? raw.sources.slice(0, 20) : [];
  const durationDays = Number(raw.durationDays);

  if (outline.length === 0 || !Number.isFinite(durationDays)) {
    return null;
  }

  return {
    title: text(raw.title, 180) || "AIC Reading Plan",
    scope: text(raw.scope, 40) as ReadingPlanResult["scope"],
    durationDays,
    translationId: text(raw.translationId, 80) || "111",
    topic: text(raw.topic, 180),
    selectedBooks: stringArray(raw.selectedBooks, 66, 40),
    coverageLabel: normalizeCoverageLabel(raw.coverageLabel),
    sourceSummary: text(raw.sourceSummary, 2_500),
    generatedDays: generatedDays.map((day) => ({
      day: Number(day.day),
      title: text(day.title, 180),
      reference: text(day.reference, 180),
      scriptureAnchor: text(day.scriptureAnchor, 600),
      expositoryReading: text(day.expositoryReading, 16_000),
      reflectionPrompts: stringArray(day.reflectionPrompts, 4, 400),
      citations: stringArray(day.citations, 12, 24),
      cycleNote: text(day.cycleNote, 400) || undefined,
      scripture: day.scripture,
    })).filter((day) => Number.isFinite(day.day)),
    outline: outline.map((item) => ({
      day: Number(item.day),
      reference: text(item.reference, 180),
      titleSeed: text(item.titleSeed, 180),
      cycleNote: text(item.cycleNote, 400) || undefined,
    })).filter((item) => Number.isFinite(item.day) && item.reference),
    sources: sources.map((source) => ({
      ...source,
      citationId: text(source.citationId, 24),
      sourceType: text(source.sourceType, 80),
      trackId: text(source.trackId, 80),
      title: text(source.title, 240),
      publishDate: text(source.publishDate, 80),
      segmentId: text(source.segmentId, 120),
      snippet: text(source.snippet, 1_200),
      startTime: text(source.startTime, 80),
      endTime: text(source.endTime, 80),
      score: Number(source.score) || 0,
      vectorModel: text(source.vectorModel, 120),
    })),
    provider: text(raw.provider, 80),
    model: text(raw.model, 120),
  };
}

export async function POST(request: NextRequest) {
  const rawLength = request.headers.get("content-length");
  const contentLength = rawLength ? Number(rawLength) : 0;
  if (Number.isFinite(contentLength) && contentLength > MAX_EXPORT_BODY_BYTES) {
    return NextResponse.json({ error: "Reading-plan export request is too large." }, { status: 413 });
  }

  const { userId } = await auth.protect();
  const rateLimit = checkChatRateLimit(request, userId);
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Too many reading-plan export requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  const payload = (await request.json().catch(() => ({}))) as ExportRequest;
  const plan = normalizePlan(payload.plan);
  if (!plan) {
    return NextResponse.json({ error: "Reading-plan export data is invalid." }, { status: 400 });
  }

  try {
    const html = await buildReadingPlanExportHtml(plan);

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${readingPlanExportFilename(plan)}"`,
      },
    });
  } catch (error) {
    console.error("reading-plan export failed", error);
    return NextResponse.json({ error: publicChatError(error) }, { status: 503 });
  }
}
