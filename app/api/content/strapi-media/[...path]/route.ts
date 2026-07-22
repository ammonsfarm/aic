import { NextRequest, NextResponse } from "next/server";

import {
  isForbiddenError,
  requireContentManagerApiUser,
} from "@/lib/rbac";
import { fetchWithTimeout, strapiUploadTimeoutMs } from "@/lib/strapi-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function strapiBaseUrl() {
  const value = process.env.STRAPI_MANAGEMENT_URL?.trim() || process.env.STRAPI_URL?.trim() || "";
  if (!value) {
    throw new Error("Strapi media preview is not configured.");
  }
  return value.replace(/\/+$/, "");
}

function strapiToken() {
  return (
    process.env.STRAPI_API_TOKEN_TEMP_WRITE?.trim() ||
    process.env.STRAPI_MANAGEMENT_TOKEN?.trim() ||
    process.env.STRAPI_API_TOKEN?.trim() ||
    ""
  );
}

function safeUploadPath(parts: string[]) {
  if (!parts.length || parts.length > 20) {
    return "";
  }

  const valid = parts.every((part) => (
    part.length > 0 &&
    part.length <= 255 &&
    part !== "." &&
    part !== ".." &&
    !part.includes("/") &&
    !part.includes("\\") &&
    !part.includes("\0")
  ));
  return valid ? `/uploads/${parts.map(encodeURIComponent).join("/")}` : "";
}

function copyHeader(source: Headers, target: Headers, name: string) {
  const value = source.get(name);
  if (value) target.set(name, value);
}

async function authorizeContentManager() {
  try {
    await requireContentManagerApiUser();
    return null;
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: "Content Manager role is required." }, { status: 403 });
    }
    throw error;
  }
}

async function proxyStrapiMedia(request: NextRequest, context: RouteContext) {
  const forbidden = await authorizeContentManager();
  if (forbidden) return forbidden;

  const { path } = await context.params;
  const uploadPath = safeUploadPath(path);
  if (!uploadPath) {
    return NextResponse.json({ error: "Invalid Strapi upload path." }, { status: 400 });
  }

  const token = strapiToken();
  if (!token) {
    return NextResponse.json({ error: "Strapi media preview is not configured." }, { status: 503 });
  }

  let upstream: Response;
  try {
    const headers = new Headers({ Authorization: `Bearer ${token}` });
    const range = request.headers.get("range");
    if (range) headers.set("Range", range);
    upstream = await fetchWithTimeout(new URL(uploadPath, strapiBaseUrl()), {
      method: request.method,
      headers,
      cache: "no-store",
      signal: request.signal,
    }, strapiUploadTimeoutMs());
  } catch (error) {
    console.error("Authenticated Strapi media preview failed", error);
    return NextResponse.json({ error: "Strapi media is temporarily unavailable." }, { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 206) {
    if (upstream.status === 404 || upstream.status === 416) {
      return new NextResponse(null, { status: upstream.status });
    }
    console.error("Authenticated Strapi media preview returned", upstream.status);
    return NextResponse.json({ error: "Strapi media is temporarily unavailable." }, { status: 502 });
  }

  const responseHeaders = new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of [
    "accept-ranges",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
  ]) {
    copyHeader(upstream.headers, responseHeaders, name);
  }

  const contentType = upstream.headers.get("content-type")?.toLowerCase() || "application/octet-stream";
  if (contentType.includes("svg") || contentType.includes("html") || contentType.includes("xml")) {
    responseHeaders.set("Content-Disposition", `attachment; filename="${path.at(-1)?.replace(/["\\]/g, "_") || "media"}"`);
  }

  return new NextResponse(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyStrapiMedia(request, context);
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  return proxyStrapiMedia(request, context);
}
