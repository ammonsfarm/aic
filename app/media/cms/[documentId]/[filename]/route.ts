import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { authorizedPublishedCmsMedia, resolveCmsMediaPath } from "@/lib/cms-public-media";
import { parseSingleByteRange } from "@/lib/public-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ documentId: string; filename: string }> };

async function serve(request: Request, { params }: Context) {
  const { documentId, filename } = await params;
  const media = await authorizedPublishedCmsMedia(documentId);
  if (!media) return new Response(null, { status: 404 });
  let authorizedFilename = "";
  try {
    authorizedFilename = path.basename(new URL(media.url, "http://strapi.invalid").pathname);
  } catch {
    return new Response(null, { status: 404 });
  }
  if (filename !== authorizedFilename) return new Response(null, { status: 404 });
  const resolved = resolveCmsMediaPath(filename);
  if (!resolved) return new Response(null, { status: 404 });
  try {
    const [rootPath, filePath, stats] = await Promise.all([realpath(resolved.root), realpath(resolved.filePath), lstat(resolved.filePath)]);
    if (!stats.isFile() || stats.isSymbolicLink() || !filePath.startsWith(`${rootPath}${path.sep}`)) return new Response(null, { status: 404 });
    const range = parseSingleByteRange(request.headers.get("range"), stats.size);
    if (range?.invalid) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stats.size}` } });
    const start = range?.start ?? 0;
    const end = range?.end ?? stats.size - 1;
    const length = range?.length ?? stats.size;
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Content-Length": String(length),
      "Content-Type": media.mime,
      "X-Content-Type-Options": "nosniff",
    });
    if (range) headers.set("Content-Range", `bytes ${start}-${end}/${stats.size}`);
    const body = request.method === "HEAD" ? null : Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>;
    return new Response(body, { status: range ? 206 : 200, headers });
  } catch {
    return new Response(null, { status: 404 });
  }
}

export const GET = serve;
export const HEAD = serve;
