import { NextRequest, NextResponse } from "next/server";

import { queryRows } from "@/lib/db";
import { getMutationApiUser } from "@/lib/rbac";

type RouteParams = {
  trackId: string;
};

type RouteContext = {
  params: Promise<RouteParams>;
};

type TranscriptEditPayload = {
  segmentId?: string;
  originalText?: string;
  editedText?: string;
};

type TranscriptSourceRow = {
  segment_id: string;
  segment_index: number | null;
  source_table: "transcript_segments" | "transcript_chunks";
  text: string;
};

type TranscriptEditRow = {
  id: string;
  status: string;
  created_at: string;
};

function normalizeTranscriptText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function validatePayload(payload: TranscriptEditPayload) {
  const segmentId = (payload.segmentId ?? "").trim();
  const originalText = normalizeTranscriptText((payload.originalText ?? "").toString());
  const editedText = normalizeTranscriptText((payload.editedText ?? "").toString());

  if (!segmentId) {
    return { error: "segmentId is required" };
  }

  if (!originalText) {
    return { error: "originalText is required" };
  }

  if (!editedText) {
    return { error: "editedText is required" };
  }

  if (editedText.length > 20_000) {
    return { error: "editedText must be 20,000 characters or fewer" };
  }

  if (editedText === originalText) {
    return { error: "editedText must differ from the current transcript text" };
  }

  return { segmentId, originalText, editedText };
}

async function findTranscriptSource(trackId: string, segmentId: string) {
  const rows = await queryRows<TranscriptSourceRow>(
    `
      select
        segment_id,
        segment_index,
        'transcript_segments'::text as source_table,
        text
      from transcript_segments
      where track_id = $1
        and segment_id = $2
      union all
      select
        custom_id as segment_id,
        null::integer as segment_index,
        'transcript_chunks'::text as source_table,
        text
      from transcript_chunks
      where track_id = $1
        and custom_id = $2
      limit 1
    `,
    [trackId, segmentId],
  );

  return rows[0] ?? null;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { trackId } = await params;
  const appUser = await getMutationApiUser();
  if (!appUser) {
    return NextResponse.json({ error: "This role cannot change transcript data." }, { status: 403 });
  }

  if (!trackId) {
    return NextResponse.json({ error: "track_id is required" }, { status: 400 });
  }

  const payload = (await request.json().catch(() => ({}))) as TranscriptEditPayload;
  const parsed = validatePayload(payload);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const source = await findTranscriptSource(trackId, parsed.segmentId);
  if (!source) {
    return NextResponse.json({ error: "Transcript segment not found" }, { status: 404 });
  }

  const sourceText = normalizeTranscriptText(source.text);
  if (sourceText !== parsed.originalText) {
    return NextResponse.json(
      { error: "Transcript text changed before this edit was saved. Refresh and try again." },
      { status: 409 },
    );
  }

  const rows = await queryRows<TranscriptEditRow>(
    `
      insert into transcript_edit_requests(
        track_id,
        segment_id,
        segment_index,
        source_table,
        source_field,
        original_text,
        edited_text,
        edited_by,
        status,
        needs_revectorization
      )
      values ($1, $2, $3, $4, 'text', $5, $6, $7, 'pending', true)
      returning id::text, status, created_at::text
    `,
    [
      trackId,
      parsed.segmentId,
      source.segment_index,
      source.source_table,
      parsed.originalText,
      parsed.editedText,
      appUser.email,
    ],
  );

  return NextResponse.json({ edit: rows[0] }, { status: 201 });
}
