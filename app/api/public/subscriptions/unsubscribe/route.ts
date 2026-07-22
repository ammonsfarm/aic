import { NextResponse } from "next/server";

import {
  isSameSiteSubscriptionRequest,
  readSubscriptionJson,
  SubscriptionBodyTooLargeError,
  unsubscribePublicSubscription,
} from "@/lib/public-subscriptions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameSiteSubscriptionRequest(request)) {
    return NextResponse.json({ error: "Cross-site unsubscribe requests are not accepted." }, { status: 403 });
  }
  if ((request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
  }
  let payload: unknown;
  try {
    payload = await readSubscriptionJson(request, 2_000);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof SubscriptionBodyTooLargeError ? "Request is too large." : "Request body must be valid JSON." },
      { status: error instanceof SubscriptionBodyTooLargeError ? 413 : 400 },
    );
  }
  const token = payload && typeof payload === "object" ? (payload as Record<string, unknown>).token : null;
  try {
    const result = await unsubscribePublicSubscription(token);
    if (!result.ok) return NextResponse.json({ error: "This unsubscribe link is invalid." }, { status: 400 });
    return NextResponse.json(
      { ok: true, message: "You will no longer receive the weekly devotional at this address." },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Public unsubscribe failed.", error);
    return NextResponse.json({ error: "Unsubscribe is temporarily unavailable. Please try again." }, { status: 503 });
  }
}
