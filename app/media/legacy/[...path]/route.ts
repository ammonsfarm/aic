import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { parseSingleByteRange, resolvePublicMediaFile } from "@/lib/public-media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ path: string[] }> };

async function responseFor(request: Request, context: RouteContext, headOnly: boolean) {
  const { path: segments } = await context.params;
  const resolved = resolvePublicMediaFile(segments || []);
  if (!resolved) return new Response("Not found", { status: 404 });

  try {
    const [rootPath, filePath, fileStat] = await Promise.all([
      realpath(process.env.PASTORWOOD_PUBLIC_MEDIA_ROOT || "/mnt/storage/pastorwood-media/public"),
      realpath(resolved.filePath),
      lstat(resolved.filePath),
    ]);
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || (filePath !== rootPath && !filePath.startsWith(`${rootPath}${path.sep}`))) {
      return new Response("Not found", { status: 404 });
    }

    const range = parseSingleByteRange(request.headers.get("range"), fileStat.size);
    if (range?.invalid) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${fileStat.size}` } });
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, fileStat.size - 1);
    const length = range?.length ?? fileStat.size;
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Content-Length": String(length),
      "Content-Type": resolved.entry.mimeType || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    if (range) headers.set("Content-Range", `bytes ${start}-${end}/${fileStat.size}`);
    const body = headOnly
      ? null
      : (Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>);
    return new Response(body, { status: range ? 206 : 200, headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

export async function GET(request: Request, context: RouteContext) {
  return responseFor(request, context, false);
}

export async function HEAD(request: Request, context: RouteContext) {
  return responseFor(request, context, true);
}
