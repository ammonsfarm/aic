import "server-only";

import { getPool, queryRows } from "@/lib/db";
import { calculateFreshness, type DataFreshness } from "@/lib/podcast-reporting";

export const retryablePipelineStages = ["daily-ingest", "podtrac-import", "transcript-edits"] as const;
export type RetryablePipelineStage = (typeof retryablePipelineStages)[number];

type IngestRunRow = {
  run_id: string;
  status: string;
  stage: string;
  started_at: string;
  completed_at: string | null;
  error: string;
};

type StageEventRow = {
  id: string;
  run_id: string;
  stage: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error: string;
};

type PodtracRunRow = {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error: string;
  import_run_id: string | null;
  import_started_at: string | null;
  imported_through: string | null;
};

type TranscriptStatusRow = {
  status: string;
  count: string;
  latest: string | null;
};

type TranscriptRequestRow = {
  id: string;
  track_id: string;
  episode_title: string;
  status: string;
  edited_by: string;
  created_at: string;
  updated_at: string;
  processing_error: string;
  attempt_count: number;
  next_attempt_at: string;
  needs_revectorization: boolean;
  revectorization_attempt_count: number;
  next_revectorization_at: string;
  terminal_edit: boolean;
  terminal_revectorization: boolean;
};

type RetryRequestRow = {
  id: string;
  stage: RetryablePipelineStage;
  source_run_id: string | null;
  reason: string;
  status: string;
  requested_by: string;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  output_summary: string;
  error: string;
};

type AuditRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_email: string;
  detail_json: Record<string, unknown>;
  created_at: string;
};

type UnmatchedPodtracRow = {
  podtrac_episode_id: string;
  title: string;
  publish_date: string | null;
  match_status: string;
  match_notes: string;
  candidates: Array<{
    trackId: string;
    title: string;
    publishDate: string;
    score: number;
  }> | null;
};

type MatchedPodtracRow = {
  podtrac_episode_id: string;
  title: string;
  publish_date: string | null;
  match_notes: string;
  track_id: string;
  episode_title: string;
  episode_publish_date: string;
};

type ExtentRow = {
  podtrac_current_through: string | null;
  ingest_current_through: string | null;
};

export type OperationalRun = {
  id: string;
  source: "daily-ingest" | "podtrac-import";
  status: string;
  stage: string;
  startedAt: string;
  completedAt: string | null;
  error: string;
  dataCurrentThrough: string | null;
};

export type OperationalStageEvent = {
  id: string;
  runId: string;
  stage: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  error: string;
};

export type OperationalDashboard = {
  generatedAt: string;
  freshness: {
    ingest: DataFreshness;
    podtrac: DataFreshness;
  };
  podtracAuth: {
    state: "ok" | "auth-error" | "unknown";
    checkedAt: string | null;
    message: string;
  };
  runs: OperationalRun[];
  stageEvents: OperationalStageEvent[];
  transcript: {
    counts: Record<string, number>;
    latestUpdate: string | null;
    recent: Array<{
      id: string;
      trackId: string;
      episodeTitle: string;
      status: string;
      editedBy: string;
      createdAt: string;
      updatedAt: string;
      error: string;
      attemptCount: number;
      nextAttemptAt: string;
      needsRevectorization: boolean;
      revectorizationAttemptCount: number;
      nextRevectorizationAt: string;
      terminalEdit: boolean;
      terminalRevectorization: boolean;
    }>;
  };
  retries: Array<{
    id: string;
    stage: RetryablePipelineStage;
    sourceRunId: string | null;
    reason: string;
    status: string;
    requestedBy: string;
    requestedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    outputSummary: string;
    error: string;
  }>;
  audit: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    actorEmail: string;
    detail: Record<string, unknown>;
    createdAt: string;
  }>;
};

export type UnmatchedPodtracEpisode = {
  podtracEpisodeId: string;
  title: string;
  publishDate: string | null;
  matchStatus: string;
  matchNotes: string;
  candidates: Array<{ trackId: string; title: string; publishDate: string; score: number }>;
};

export type MatchedPodtracEpisode = {
  podtracEpisodeId: string;
  title: string;
  publishDate: string | null;
  matchNotes: string;
  trackId: string;
  episodeTitle: string;
  episodePublishDate: string;
};

export type EpisodeOperationalStatus = {
  trackId: string;
  title: string;
  coverage: {
    transcriptChunks: number;
    transcriptSegments: number;
    intelligenceRows: number;
    intelligenceVectors: number;
    podtracRows: number;
  };
  transcriptEdits: Record<string, number>;
  latestTranscriptEditAt: string | null;
  latestTranscriptError: string;
};

export function parseRetryableStage(value: unknown): RetryablePipelineStage | null {
  return typeof value === "string" && retryablePipelineStages.includes(value as RetryablePipelineStage)
    ? (value as RetryablePipelineStage)
    : null;
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function podtracAuthenticationStatus(
  latestRun: Pick<PodtracRunRow, "status" | "started_at" | "completed_at" | "error"> | null | undefined,
) {
  if (!latestRun) {
    return { state: "unknown" as const, checkedAt: null, message: "No authoritative Podtrac sync run has been recorded." };
  }

  const checkedAt = latestRun.completed_at ?? latestRun.started_at;
  const authError = /(?:authentication failed|http\s+(?:401|403)|unauthori[sz]ed|forbidden)/i.test(latestRun.error);
  if (latestRun.status === "failed" && authError) {
    return {
      state: "auth-error" as const,
      checkedAt,
      message: "The latest Podtrac sync run failed authentication. Refresh the approved Podtrac session before retrying.",
    };
  }

  if (latestRun.status === "completed") {
    return { state: "ok" as const, checkedAt, message: "The latest authoritative Podtrac sync run completed without an authentication error." };
  }

  if (latestRun.status === "running") {
    return { state: "unknown" as const, checkedAt, message: "The latest Podtrac sync run is still in progress." };
  }

  return {
    state: "unknown" as const,
    checkedAt,
    message: latestRun.error
      ? "The latest Podtrac sync run failed for a reason other than authentication. Review pipeline history."
      : `The latest Podtrac sync run has status ${latestRun.status || "unknown"}.`,
  };
}

export async function getOperationalDashboard({ limit = 20 }: { limit?: number } = {}): Promise<OperationalDashboard> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 5), 100);
  const [ingestRows, stageRows, podtracRows, transcriptStatusRows, transcriptRows, retryRows, auditRows, extentRows] =
    await Promise.all([
      queryRows<IngestRunRow>(
        `select run_id, status, stage, started_at, completed_at, error
           from ingest_runs
          order by coalesce(completed_at, started_at) desc
          limit $1`,
        [safeLimit],
      ),
      queryRows<StageEventRow>(
        `select id::text, run_id, stage, status, started_at, completed_at, error
           from ingest_stage_events
          order by id desc
          limit $1`,
        [safeLimit * 3],
      ),
      queryRows<PodtracRunRow>(
        `select
           psr.id::text,
           psr.status,
           psr.started_at::text,
           psr.completed_at::text,
           psr.error,
           pir.run_id::text as import_run_id,
           pir.imported_at as import_started_at,
           pir.summary #>> '{date_window,end}' as imported_through
         from podtrac_sync_runs psr
         left join lateral (
           select run_id, imported_at, summary
             from podtrac_import_runs
            where updated_at between psr.started_at - interval '10 minutes'
                                 and coalesce(psr.completed_at, psr.started_at) + interval '10 minutes'
            order by updated_at desc
            limit 1
         ) pir on true
         order by psr.id desc
         limit $1`,
        [safeLimit],
      ),
      queryRows<TranscriptStatusRow>(
        `select status, count, latest
           from (
             select status, count(*)::text as count, max(updated_at)::text as latest
               from transcript_edit_requests
              group by status
             union all
             select 'needs-revectorization', count(*)::text, max(updated_at)::text
               from transcript_edit_requests
              where status = 'applied' and needs_revectorization
             union all
             select 'terminal-revectorization', count(*)::text, max(updated_at)::text
               from transcript_edit_requests
              where status = 'applied' and needs_revectorization
                and next_revectorization_at = 'infinity'::timestamptz
           ) summary
          where count::int > 0
          order by status`,
      ),
      queryRows<TranscriptRequestRow>(
        `select
           r.id::text,
           r.track_id,
           coalesce(e.title, r.track_id) as episode_title,
           r.status,
           r.edited_by,
           r.created_at::text,
           r.updated_at::text,
           r.processing_error,
           r.attempt_count,
           r.next_attempt_at::text,
           r.needs_revectorization,
           r.revectorization_attempt_count,
           r.next_revectorization_at::text,
           (r.status = 'failed' and r.next_attempt_at = 'infinity'::timestamptz) as terminal_edit,
           (r.status = 'applied' and r.needs_revectorization
             and r.next_revectorization_at = 'infinity'::timestamptz) as terminal_revectorization
         from transcript_edit_requests r
         left join episodes e on e.track_id = r.track_id
         order by r.updated_at desc
         limit $1`,
        [safeLimit],
      ),
      queryRows<RetryRequestRow>(
        `select id::text, stage, source_run_id, reason, status, requested_by,
                requested_at::text, started_at::text, completed_at::text, output_summary, error
           from pipeline_retry_requests
          order by requested_at desc
          limit $1`,
        [safeLimit],
      ),
      queryRows<AuditRow>(
        `select id::text, action, entity_type, entity_id, actor_email, detail_json, created_at::text
           from admin_operation_audit
          order by created_at desc
          limit $1`,
        [safeLimit],
      ),
      queryRows<ExtentRow>(
        `select
           (select max(activity_date)::text from podtrac_daily_activity) as podtrac_current_through,
           (select max(completed_at)::timestamptz::date::text from ingest_runs where status = 'completed') as ingest_current_through`,
      ),
    ]);

  const extent = extentRows[0] ?? { podtrac_current_through: null, ingest_current_through: null };
  const auth = podtracAuthenticationStatus(podtracRows[0]);
  const latestTranscriptUpdate = transcriptStatusRows
    .map((row) => row.latest)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    generatedAt: new Date().toISOString(),
    freshness: {
      ingest: calculateFreshness({ dataCurrentThrough: extent.ingest_current_through, slaDays: 1 }),
      podtrac: calculateFreshness({ dataCurrentThrough: extent.podtrac_current_through, slaDays: 2 }),
    },
    podtracAuth: auth,
    runs: [
      ...ingestRows.map((row) => ({
        id: row.run_id,
        source: "daily-ingest" as const,
        status: row.status,
        stage: row.stage,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        error: row.error,
        dataCurrentThrough: row.completed_at?.slice(0, 10) ?? null,
      })),
      ...podtracRows.map((row) => ({
        id: row.import_run_id ?? row.id,
        source: "podtrac-import" as const,
        status: row.status,
        stage: "podtrac-import",
        startedAt: row.import_started_at ?? row.started_at,
        completedAt: row.completed_at,
        error: row.error,
        dataCurrentThrough: row.imported_through,
      })),
    ].sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt)).slice(0, safeLimit),
    stageEvents: stageRows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      stage: row.stage,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error,
    })),
    transcript: {
      counts: Object.fromEntries(transcriptStatusRows.map((row) => [row.status, Number(row.count) || 0])),
      latestUpdate: latestTranscriptUpdate,
      recent: transcriptRows.map((row) => ({
        id: row.id,
        trackId: row.track_id,
        episodeTitle: row.episode_title,
        status: row.status,
        editedBy: row.edited_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        error: row.processing_error,
        attemptCount: Number(row.attempt_count) || 0,
        nextAttemptAt: row.next_attempt_at,
        needsRevectorization: row.needs_revectorization,
        revectorizationAttemptCount: Number(row.revectorization_attempt_count) || 0,
        nextRevectorizationAt: row.next_revectorization_at,
        terminalEdit: row.terminal_edit,
        terminalRevectorization: row.terminal_revectorization,
      })),
    },
    retries: retryRows.map((row) => ({
      id: row.id,
      stage: row.stage,
      sourceRunId: row.source_run_id,
      reason: row.reason,
      status: row.status,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      outputSummary: row.output_summary,
      error: row.error,
    })),
    audit: auditRows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actorEmail: row.actor_email,
      detail: row.detail_json,
      createdAt: row.created_at,
    })),
  };
}

export async function listUnmatchedPodtracEpisodes({
  query = "",
  limit = 20,
}: {
  query?: string;
  limit?: number;
} = {}): Promise<UnmatchedPodtracEpisode[]> {
  const search = boundedText(query, 120);
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 5), 100);
  const rows = await queryRows<UnmatchedPodtracRow>(
    `select
       pe.podtrac_episode_id,
       pe.title,
       pe.publish_date::text,
       pe.match_status,
       pe.match_notes,
       coalesce(c.candidates, '[]'::jsonb) as candidates
     from podtrac_episodes pe
     left join lateral (
       select jsonb_agg(jsonb_build_object(
         'trackId', candidate.track_id,
         'title', candidate.title,
         'publishDate', candidate.publish_date,
         'score', candidate.score
       ) order by candidate.score desc, candidate.publish_date desc) as candidates
       from (
         select
           e.track_id,
           e.title,
           e.publish_date::text as publish_date,
           round(similarity(lower(e.title), lower(pe.title))::numeric, 4)::float8 as score
         from episodes e
         where similarity(lower(e.title), lower(pe.title)) >= 0.2
            or (
              pe.publish_date is not null
              and e.publish_date::text ~ '^\\d{4}-\\d{2}-\\d{2}$'
              and abs((e.publish_date::date - pe.publish_date)) <= 10
            )
         order by similarity(lower(e.title), lower(pe.title)) desc,
                  case when e.publish_date::text ~ '^\\d{4}-\\d{2}-\\d{2}$' then abs((e.publish_date::date - pe.publish_date)) end asc nulls last
         limit 5
       ) candidate
     ) c on true
     where (pe.track_id is null or pe.match_status = 'unmatched')
       and ($1 = '' or pe.title ilike '%' || $1 || '%' or pe.podtrac_episode_id ilike '%' || $1 || '%')
     order by pe.publish_date desc nulls last, pe.title
     limit $2`,
    [search, safeLimit],
  );

  return rows.map((row) => ({
    podtracEpisodeId: row.podtrac_episode_id,
    title: row.title,
    publishDate: row.publish_date,
    matchStatus: row.match_status,
    matchNotes: row.match_notes,
    candidates: Array.isArray(row.candidates) ? row.candidates : [],
  }));
}

export async function listMatchedPodtracEpisodes({
  query = "",
  limit = 20,
}: {
  query?: string;
  limit?: number;
} = {}): Promise<MatchedPodtracEpisode[]> {
  const search = boundedText(query, 120);
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 5), 100);
  const rows = await queryRows<MatchedPodtracRow>(
    `select
       pe.podtrac_episode_id,
       pe.title,
       pe.publish_date::text,
       pe.match_notes,
       pe.track_id,
       coalesce(e.title, pe.matched_episode_title, pe.track_id) as episode_title,
       coalesce(e.publish_date::text, nullif(pe.matched_episode_publish_date, ''), '') as episode_publish_date
     from podtrac_episodes pe
     left join episodes e on e.track_id = pe.track_id
     where pe.track_id is not null
       and pe.match_status = 'matched'
       and (
         $1 = ''
         or pe.title ilike '%' || $1 || '%'
         or pe.podtrac_episode_id ilike '%' || $1 || '%'
         or pe.track_id ilike '%' || $1 || '%'
         or e.title ilike '%' || $1 || '%'
       )
     order by pe.updated_at desc, pe.publish_date desc nulls last, pe.title
     limit $2`,
    [search, safeLimit],
  );

  return rows.map((row) => ({
    podtracEpisodeId: row.podtrac_episode_id,
    title: row.title,
    publishDate: row.publish_date,
    matchNotes: row.match_notes,
    trackId: row.track_id,
    episodeTitle: row.episode_title,
    episodePublishDate: row.episode_publish_date,
  }));
}

export async function getEpisodeOperationalStatus(trackId: string): Promise<EpisodeOperationalStatus | null> {
  const normalizedTrackId = boundedText(trackId, 200);
  if (!normalizedTrackId) {
    return null;
  }
  const rows = await queryRows<{
    track_id: string;
    title: string;
    transcript_chunks: string;
    transcript_segments: string;
    intelligence_rows: string;
    intelligence_vectors: string;
    podtrac_rows: string;
    edit_counts: Record<string, number> | null;
    latest_edit_at: string | null;
    latest_edit_error: string | null;
  }>(
    `select
       e.track_id,
       e.title,
       (select count(*)::text from transcript_chunks tc where tc.track_id = e.track_id) as transcript_chunks,
       (select count(*)::text from transcript_segments ts where ts.track_id = e.track_id) as transcript_segments,
       (select count(*)::text from episode_intelligence ei where ei.track_id = e.track_id) as intelligence_rows,
       (select count(*)::text from episode_intelligence_vectors eiv where eiv.track_id = e.track_id) as intelligence_vectors,
       (select count(*)::text from podtrac_episodes pe where pe.track_id = e.track_id) as podtrac_rows,
       coalesce((
         select jsonb_object_agg(status, count)
         from (select status, count(*)::int as count from transcript_edit_requests where track_id = e.track_id group by status) edits
       ), '{}'::jsonb) as edit_counts,
       (select max(updated_at)::text from transcript_edit_requests where track_id = e.track_id) as latest_edit_at,
       coalesce((
         select processing_error from transcript_edit_requests
          where track_id = e.track_id and processing_error <> ''
          order by updated_at desc limit 1
       ), '') as latest_edit_error
     from episodes e
     where e.track_id = $1
     limit 1`,
    [normalizedTrackId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    trackId: row.track_id,
    title: row.title,
    coverage: {
      transcriptChunks: Number(row.transcript_chunks) || 0,
      transcriptSegments: Number(row.transcript_segments) || 0,
      intelligenceRows: Number(row.intelligence_rows) || 0,
      intelligenceVectors: Number(row.intelligence_vectors) || 0,
      podtracRows: Number(row.podtrac_rows) || 0,
    },
    transcriptEdits: row.edit_counts ?? {},
    latestTranscriptEditAt: row.latest_edit_at,
    latestTranscriptError: row.latest_edit_error ?? "",
  };
}

export async function queuePipelineRetry({
  stage,
  sourceRunId,
  reason,
  actorEmail,
}: {
  stage: RetryablePipelineStage;
  sourceRunId?: string | null;
  reason?: string;
  actorEmail: string;
}) {
  const normalizedSourceRunId = boundedText(sourceRunId, 120) || null;
  const normalizedReason = boundedText(reason, 1000);
  if (stage === "transcript-edits" && !normalizedReason) {
    throw new Error("A reason is required before retrying transcript edits or terminal vector work.");
  }
  const client = await getPool().connect();
  try {
    await client.query("begin");
    let terminalReset = { edit_count: 0, revectorization_count: 0 };
    if (stage === "transcript-edits") {
      const resetResult = await client.query<{ edit_count: number; revectorization_count: number }>(
        `with candidates as (
           select id,
                  next_attempt_at = 'infinity'::timestamptz as edit_terminal,
                  next_revectorization_at = 'infinity'::timestamptz as revectorization_terminal
             from transcript_edit_requests
            where next_attempt_at = 'infinity'::timestamptz
               or next_revectorization_at = 'infinity'::timestamptz
            for update
         ), reset as (
           update transcript_edit_requests r
              set attempt_count = case when c.edit_terminal then 0 else r.attempt_count end,
                  next_attempt_at = case when c.edit_terminal then now() else r.next_attempt_at end,
                  revectorization_attempt_count = case when c.revectorization_terminal then 0 else r.revectorization_attempt_count end,
                  next_revectorization_at = case when c.revectorization_terminal then now() else r.next_revectorization_at end,
                  claimed_at = null,
                  worker_id = '',
                  revectorization_claimed_at = null,
                  revectorization_worker_id = '',
                  processing_error = '',
                  updated_at = now()
             from candidates c
            where r.id = c.id
            returning c.edit_terminal, c.revectorization_terminal
         )
         select count(*) filter (where edit_terminal)::int as edit_count,
                count(*) filter (where revectorization_terminal)::int as revectorization_count
           from reset`,
      );
      terminalReset = resetResult.rows[0] ?? terminalReset;
    }
    const result = await client.query<RetryRequestRow>(
      `insert into pipeline_retry_requests(stage, source_run_id, reason, requested_by)
       values ($1, $2, $3, $4)
       returning id::text, stage, source_run_id, reason, status, requested_by,
                 requested_at::text, started_at::text, completed_at::text, output_summary, error`,
      [stage, normalizedSourceRunId, normalizedReason, actorEmail],
    );
    const request = result.rows[0];
    await client.query(
      `insert into admin_operation_audit(action, entity_type, entity_id, actor_email, detail_json)
       values ('pipeline_retry_queued', 'pipeline_retry_request', $1, $2, $3::jsonb)`,
      [request.id, actorEmail, JSON.stringify({ stage, sourceRunId: normalizedSourceRunId, reason: normalizedReason })],
    );
    if (stage === "transcript-edits" && (terminalReset.edit_count || terminalReset.revectorization_count)) {
      await client.query(
        `insert into admin_operation_audit(action, entity_type, entity_id, actor_email, detail_json)
         values ('transcript_terminal_retry_reset', 'pipeline_retry_request', $1, $2, $3::jsonb)`,
        [
          request.id,
          actorEmail,
          JSON.stringify({
            reason: normalizedReason,
            editCount: terminalReset.edit_count,
            revectorizationCount: terminalReset.revectorization_count,
          }),
        ],
      );
    }
    await client.query("commit");
    return request;
  } catch (error) {
    await client.query("rollback");
    if ((error as { code?: string }).code === "23505") {
      throw new Error(`A ${stage} request is already queued or running.`);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function reconcilePodtracEpisode({
  podtracEpisodeId,
  trackId,
  note,
  actorEmail,
}: {
  podtracEpisodeId: string;
  trackId: string | null;
  note?: string;
  actorEmail: string;
}) {
  const normalizedPodtracId = boundedText(podtracEpisodeId, 200);
  const normalizedTrackId = boundedText(trackId, 200) || null;
  const normalizedNote = boundedText(note, 1000);
  if (!normalizedPodtracId) {
    throw new Error("A Podtrac episode is required.");
  }
  if (!normalizedTrackId && !normalizedNote) {
    throw new Error("An audit note is required before removing a Podtrac match.");
  }

  const client = await getPool().connect();
  try {
    await client.query("begin");
    const current = await client.query<{
      podtrac_episode_id: string;
      track_id: string | null;
      match_status: string;
    }>(
      `select podtrac_episode_id, track_id, match_status
         from podtrac_episodes
        where podtrac_episode_id = $1
        for update`,
      [normalizedPodtracId],
    );
    const episode = current.rows[0];
    if (!episode) {
      throw new Error("Podtrac episode was not found.");
    }

    if (normalizedTrackId) {
      const target = await client.query("select track_id from episodes where track_id = $1 limit 1", [normalizedTrackId]);
      if (!target.rows[0]) {
        throw new Error("The selected archive episode was not found.");
      }
    }

    const action = normalizedTrackId ? "match" : "unmatch";
    await client.query(
      `update podtrac_episodes
          set track_id = $2,
              matched_episode_title = coalesce((select title from episodes where track_id = $2), ''),
              matched_episode_publish_date = coalesce((select publish_date from episodes where track_id = $2), ''),
              match_status = case when $2 is null then 'unmatched' else 'matched' end,
              match_method = case when $2 is null then '' else 'manual_admin' end,
              match_score = case when $2 is null then null else 1 end,
              match_notes = $3,
              updated_at = now()
        where podtrac_episode_id = $1`,
      [normalizedPodtracId, normalizedTrackId, normalizedNote],
    );
    const audit = await client.query<{ id: string }>(
      `insert into podtrac_reconciliation_audit(
         podtrac_episode_id, previous_track_id, assigned_track_id, previous_match_status, action, note, actor_email
       ) values ($1, $2, $3, $4, $5, $6, $7)
       returning id::text`,
      [normalizedPodtracId, episode.track_id, normalizedTrackId, episode.match_status, action, normalizedNote, actorEmail],
    );
    await client.query(
      `insert into admin_operation_audit(action, entity_type, entity_id, actor_email, detail_json)
       values ('podtrac_reconciled', 'podtrac_episode', $1, $2, $3::jsonb)`,
      [
        normalizedPodtracId,
        actorEmail,
        JSON.stringify({ action, previousTrackId: episode.track_id, assignedTrackId: normalizedTrackId, note: normalizedNote }),
      ],
    );
    await client.query("commit");
    return { auditId: audit.rows[0].id, action, podtracEpisodeId: normalizedPodtracId, trackId: normalizedTrackId };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
