import { execFile, spawn, type ChildProcess } from "node:child_process";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function isPublicEpisodeTrackId(value: string) {
  return /^(?:\d+|sa_\d+)$/.test(value);
}

function mcBin() {
  return process.env.AIC_AUDIO_MC_BIN || "/usr/local/bin/mc";
}

function audioTarget(trackId: string) {
  const alias = process.env.AIC_AUDIO_MC_ALIAS || "local-minio";
  const bucket = process.env.AIC_AUDIO_BUCKET || "aic";
  const prefix = (process.env.AIC_AUDIO_PREFIX || "podcasts").replace(/^\/+|\/+$/g, "");
  return `${alias}/${bucket}/${prefix ? `${prefix}/` : ""}${trackId}.mp3`;
}

export async function statEpisodeAudio(trackId: string) {
  if (!isPublicEpisodeTrackId(trackId)) return null;
  try {
    const { stdout } = await execFileAsync(mcBin(), ["stat", "--json", audioTarget(trackId)], { maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(stdout) as { size?: unknown };
    return typeof parsed.size === "number" && parsed.size > 0 ? parsed.size : null;
  } catch {
    return null;
  }
}

export function parseEpisodeAudioRange(value: string | null, size: number) {
  if (!value) return { start: 0, end: size - 1, partial: false as const };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1), partial: true as const };
}

type KillableChild = Pick<ChildProcess, "kill" | "once">;

export function terminateChildOnAbort(child: KillableChild, signal: AbortSignal, killTimeoutMs = 1_000) {
  let closed = false;
  let terminating = false;
  let killTimer: ReturnType<typeof setTimeout> | null = null;
  const cleanup = () => {
    closed = true;
    if (killTimer) clearTimeout(killTimer);
    signal.removeEventListener("abort", terminate);
  };
  const terminate = () => {
    if (closed || terminating) return;
    terminating = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      if (!closed) child.kill("SIGKILL");
    }, killTimeoutMs);
    if (typeof killTimer === "object" && "unref" in killTimer) killTimer.unref();
  };
  child.once("close", cleanup);
  signal.addEventListener("abort", terminate, { once: true });
  if (signal.aborted) terminate();
  return { terminate, cleanup };
}

class LimitStream extends Transform {
  private remaining: number;

  constructor(limit: number, private readonly reached: () => void) {
    super();
    this.remaining = limit;
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    if (this.remaining <= 0) return callback();
    const next = chunk.length > this.remaining ? chunk.subarray(0, this.remaining) : chunk;
    this.remaining -= next.length;
    this.push(next);
    if (this.remaining <= 0) this.reached();
    callback();
  }

  _destroy(error: Error | null, callback: (error: Error | null) => void) {
    this.reached();
    callback(error);
  }
}

export async function episodeAudioResponse(request: Request, trackId: string, cacheControl: string) {
  const size = await statEpisodeAudio(trackId);
  if (!size) return new Response(null, { status: 404 });
  const range = parseEpisodeAudioRange(request.headers.get("range"), size);
  if (!range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const length = range.end - range.start + 1;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
    "Content-Disposition": `inline; filename="${trackId}.mp3"`,
    "Content-Length": String(length),
    "Content-Type": "audio/mpeg",
    "X-Content-Type-Options": "nosniff",
  });
  if (range.partial) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  if (request.method === "HEAD") return new Response(null, { status: range.partial ? 206 : 200, headers });

  const child = spawn(mcBin(), ["cat", "--quiet", "--offset", String(range.start), audioTarget(trackId)], { stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.resume();
  const lifecycle = terminateChildOnAbort(child, request.signal);
  const source = child.stdout.pipe(new LimitStream(length, lifecycle.terminate));
  child.stdout.on("error", (error) => source.destroy(error));
  child.on("error", (error) => source.destroy(error));
  return new Response(Readable.toWeb(source) as BodyInit, { status: range.partial ? 206 : 200, headers });
}

export function publicEpisodeAudioResponse(request: Request, trackId: string) {
  return episodeAudioResponse(request, trackId, "public, max-age=3600, stale-while-revalidate=86400");
}
