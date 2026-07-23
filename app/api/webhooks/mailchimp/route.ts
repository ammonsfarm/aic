import { NextResponse } from "next/server";

import {
  applyMailchimpWebhook,
  MailchimpWebhookError,
  parseMailchimpWebhook,
  verifyMailchimpWebhookSignature,
} from "@/lib/mailchimp-subscriptions";

export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 100_000;

async function readBoundedBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    throw new MailchimpWebhookError("Mailchimp webhook request is too large.", 413);
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_WEBHOOK_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new MailchimpWebhookError("Mailchimp webhook request is too large.", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(request: Request) {
  try {
    const rawBody = await readBoundedBody(request);
    verifyMailchimpWebhookSignature(rawBody, request.headers.get("x-mailchimp-signature"));
    const event = parseMailchimpWebhook(rawBody, request.headers.get("content-type"));
    const result = await applyMailchimpWebhook(event);
    return NextResponse.json(
      { ok: true, applied: result.applied },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof MailchimpWebhookError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof SyntaxError || error instanceof TypeError) {
      return NextResponse.json(
        { error: "Mailchimp webhook body is invalid." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("Mailchimp webhook processing failed.", error);
    return NextResponse.json(
      { error: "Mailchimp webhook processing is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300" } },
    );
  }
}
