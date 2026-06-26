import { spawn, execFile } from "node:child_process";
import { Readable, Transform } from "node:stream";
import type { TransformCallback } from "node:stream";
import { promisify } from "node:util";

import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import { queryRows } from "@/lib/db";

export const runtime = "nodejs";

type RouteParams = {
  trackId: string;
};

type RouteContext = {
  params: Promise<RouteParams>;
};

type McStat = {
  size?: number;
};

const execFileAsync = promisify(execFile);

function audioTarget(trackId: string): string {
  const alias = process.env.AIC_AUDIO_MC_ALIAS || "local-minio";
  const bucket = process.env.AIC_AUDIO_BUCKET || "aic";
  const prefix = (process.env.AIC_AUDIO_PREFIX || "podcasts").replace(/^\/+|\/+$/g, "");
  const key = prefix ? `${prefix}/${trackId}.mp3` : `${trackId}.mp3`;
  return `${alias}/${bucket}/${key}`;
}

function mcBin(): string {
  return process.env.AIC_AUDIO_MC_BIN || "/usr/local/bin/mc";
}

async function statAudio(trackId: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(mcBin(), ["stat", "--json", audioTarget(trackId)], {
      maxBuffer: 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as McStat;
    return typeof parsed.size === "number" && parsed.size > 0 ? parsed.size : null;
  } catch {
    return null;
  }
}

async function getExternalAudioUrl(trackId: string): Promise<string | null> {
  if (!/^sa_\d+$/.test(trackId)) {
    return null;
  }

  const rows = await queryRows<{ audio_url: string; audio_download_url: string; sermon_url: string }>(
    `
      select audio_url, audio_download_url, sermon_url
      from sermonaudio_sermons
      where track_id = $1
      limit 1
    `,
    [trackId],
  );
  const row = rows[0];
  return row?.audio_url || row?.audio_download_url || row?.sermon_url || null;
}

function parseRange(value: string | null, size: number): { start: number; end: number; partial: boolean } | null {
  if (!value) {
    return { start: 0, end: size - 1, partial: false };
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) {
    return null;
  }

  let start = startRaw ? Number(startRaw) : 0;
  let end = endRaw ? Number(endRaw) : size - 1;

  if (!startRaw && endRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return null;
  }

  return { start, end: Math.min(end, size - 1), partial: true };
}

class LimitStream extends Transform {
  private remaining: number;

  constructor(
    limit: number,
    private readonly onLimit: () => void,
  ) {
    super();
    this.remaining = limit;
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    if (this.remaining <= 0) {
      callback();
      return;
    }

    const next = chunk.length > this.remaining ? chunk.subarray(0, this.remaining) : chunk;
    this.remaining -= next.length;
    this.push(next);

    if (this.remaining <= 0) {
      this.onLimit();
    }

    callback();
  }
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { trackId } = await params;
  await auth.protect();

  const externalAudioUrl = await getExternalAudioUrl(trackId);
  if (externalAudioUrl) {
    return NextResponse.redirect(externalAudioUrl);
  }

  if (!/^\d+$/.test(trackId)) {
    return NextResponse.json({ error: "Invalid track id" }, { status: 400 });
  }

  const size = await statAudio(trackId);
  if (!size) {
    return NextResponse.json({ error: "Audio not found" }, { status: 404 });
  }

  const range = parseRange(request.headers.get("range"), size);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${size}`,
      },
    });
  }

  const length = range.end - range.start + 1;
  const child = spawn(mcBin(), ["cat", "--quiet", "--offset", String(range.start), audioTarget(trackId)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.resume();

  const source = range.partial ? child.stdout.pipe(new LimitStream(length, () => child.kill("SIGTERM"))) : child.stdout;
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": `inline; filename="${trackId}.mp3"`,
    "Content-Length": String(length),
    "Content-Type": "audio/mpeg",
  });

  if (range.partial) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  }

  return new Response(Readable.toWeb(source) as BodyInit, {
    status: range.partial ? 206 : 200,
    headers,
  });
}
