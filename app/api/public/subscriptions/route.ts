import { NextResponse } from "next/server";

import {
  capturePublicSubscription,
  isSameSiteSubscriptionRequest,
  readSubscriptionJson,
  SubscriptionBodyTooLargeError,
  validateSubscriptionPayload,
} from "@/lib/public-subscriptions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameSiteSubscriptionRequest(request)) {
    return NextResponse.json({ error: "Cross-site subscription requests are not accepted." }, { status: 403 });
  }
  const mediaType = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 10_000) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413 });
  }
  let payload: unknown;
  try {
    payload = await readSubscriptionJson(request);
  } catch (error) {
    if (error instanceof SubscriptionBodyTooLargeError) {
      return NextResponse.json({ error: "Request is too large." }, { status: 413 });
    }
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const validation = validateSubscriptionPayload(payload);
  if (!validation.ok) {
    if (validation.bot) {
      return NextResponse.json({ ok: true, message: "Thank you." }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: validation.error }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const result = await capturePublicSubscription(validation.value, request);
    if (!result.ok) {
      if (result.reason === "suppressed") {
        return NextResponse.json(
          { error: "This subscription request could not be completed. Please contact us if you need help." },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "3600" } },
      );
    }
    return NextResponse.json(
      { ok: true, message: "You are subscribed to the weekly devotional." },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Public subscription capture failed.", error);
    return NextResponse.json(
      { error: "Subscriptions are temporarily unavailable. Please try again later." },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300" } },
    );
  }
}
