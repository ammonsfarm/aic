import { NextResponse } from "next/server";

import {
  capturePublicContactMessage,
  CONTACT_REQUEST_BODY_LIMIT,
  ContactBodyTooLargeError,
  isSameSiteContactRequest,
  readContactJson,
  validatePublicContactPayload,
} from "@/lib/public-contact";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!isSameSiteContactRequest(request)) {
    return NextResponse.json({ error: "Cross-site contact requests are not accepted." }, { status: 403, headers: noStoreHeaders });
  }
  const mediaType = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415, headers: noStoreHeaders });
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > CONTACT_REQUEST_BODY_LIMIT) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413, headers: noStoreHeaders });
  }

  let payload: unknown;
  try {
    payload = await readContactJson(request);
  } catch (error) {
    if (error instanceof ContactBodyTooLargeError) {
      return NextResponse.json({ error: "Request is too large." }, { status: 413, headers: noStoreHeaders });
    }
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400, headers: noStoreHeaders });
  }

  const validation = validatePublicContactPayload(payload);
  if (!validation.ok) {
    if (validation.bot) {
      return NextResponse.json({ ok: true, message: "Thank you." }, { status: 202, headers: noStoreHeaders });
    }
    return NextResponse.json({ error: validation.error }, { status: 400, headers: noStoreHeaders });
  }

  try {
    const result = await capturePublicContactMessage(validation.value, request);
    if (!result.ok) {
      return NextResponse.json(
        { error: "Too many messages have been submitted. Please try again later." },
        { status: 429, headers: { ...noStoreHeaders, "Retry-After": "3600" } },
      );
    }
    return NextResponse.json(
      { ok: true, message: "Thank you. Your message has been received and stored for ministry staff to review." },
      { status: 201, headers: noStoreHeaders },
    );
  } catch (error) {
    console.error("Public contact-message capture failed.", error);
    return NextResponse.json(
      { error: "The contact form is temporarily unavailable. Please call or email the ministry office instead." },
      { status: 503, headers: { ...noStoreHeaders, "Retry-After": "300" } },
    );
  }
}
