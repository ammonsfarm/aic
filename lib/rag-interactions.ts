import "server-only";

import { queryRows } from "@/lib/db";
import type { CurrentAppUser } from "@/lib/rbac";

export type RagInteractionScope = "research" | "archive" | "episode";

export type RagInteractionHistoryItem = {
  id: string;
  scope: RagInteractionScope;
  trackId: string;
  question: string;
  answer: string;
  provider: string;
  model: string;
  topK: number;
  retrievalLanes: unknown[];
  sources: unknown[];
  topEpisodeIds: string[];
  coverageNote: string;
  status: "completed" | "failed";
  error: string;
  createdAt: string;
};

type RagInteractionResult = {
  answer: string;
  provider: string;
  model: string;
  sources?: unknown[];
  topEpisodeIds?: string[];
  retrievalLanes?: unknown[];
  coverageNote?: string;
};

type RagInteractionRow = {
  id: string;
  scope: RagInteractionScope;
  track_id: string | null;
  question: string;
  answer: string;
  provider: string;
  model: string;
  top_k: number;
  retrieval_lanes: unknown;
  sources: unknown;
  top_episode_ids: unknown;
  coverage_note: string;
  status: "completed" | "failed";
  error: string;
  created_at: string;
};

function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function stringArray(value: unknown): string[] {
  return jsonArray(value)
    .map((item) => (typeof item === "string" ? item : ""))
    .filter(Boolean);
}

function toHistoryItem(row: RagInteractionRow): RagInteractionHistoryItem {
  return {
    id: row.id,
    scope: row.scope,
    trackId: row.track_id ?? "",
    question: row.question,
    answer: row.answer,
    provider: row.provider,
    model: row.model,
    topK: row.top_k,
    retrievalLanes: jsonArray(row.retrieval_lanes),
    sources: jsonArray(row.sources),
    topEpisodeIds: stringArray(row.top_episode_ids),
    coverageNote: row.coverage_note,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
  };
}

export async function recordRagInteraction({
  user,
  scope,
  trackId,
  question,
  topK,
  result,
  status,
  error,
  durationMs,
}: {
  user: CurrentAppUser;
  scope: RagInteractionScope;
  trackId?: string;
  question: string;
  topK: number;
  result?: RagInteractionResult;
  status: "completed" | "failed";
  error?: string;
  durationMs: number;
}) {
  const rows = await queryRows<{ id: string; created_at: string }>(
    `
      insert into rag_interactions(
        clerk_user_id,
        user_email,
        scope,
        track_id,
        question,
        answer,
        provider,
        model,
        top_k,
        retrieval_lanes,
        sources,
        top_episode_ids,
        coverage_note,
        status,
        error,
        duration_ms
      )
      values (
        $1, $2, $3, nullif($4, ''), $5, $6, $7, $8, $9,
        $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15, $16
      )
      returning id::text, created_at::text
    `,
    [
      user.clerkUserId,
      user.email,
      scope,
      trackId ?? "",
      question,
      result?.answer ?? "",
      result?.provider ?? "",
      result?.model ?? "",
      topK,
      JSON.stringify(result?.retrievalLanes ?? []),
      JSON.stringify(result?.sources ?? []),
      JSON.stringify(result?.topEpisodeIds ?? []),
      result?.coverageNote ?? "",
      status,
      error ?? "",
      Math.max(0, Math.trunc(durationMs)),
    ],
  );

  return rows[0] ?? null;
}

export async function getUserRagHistory({
  user,
  scope,
  trackId,
  limit = 10,
}: {
  user: CurrentAppUser;
  scope?: RagInteractionScope;
  trackId?: string;
  limit?: number;
}) {
  const values: unknown[] = [user.clerkUserId];
  const clauses = ["clerk_user_id = $1"];

  if (scope) {
    values.push(scope);
    clauses.push(`scope = $${values.length}`);
  }

  if (trackId) {
    values.push(trackId);
    clauses.push(`track_id = $${values.length}`);
  }

  values.push(Math.max(1, Math.min(Math.trunc(limit), 50)));

  const rows = await queryRows<RagInteractionRow>(
    `
      select
        id::text,
        scope,
        track_id,
        question,
        answer,
        provider,
        model,
        top_k,
        retrieval_lanes,
        sources,
        top_episode_ids,
        coverage_note,
        status,
        error,
        created_at::text
      from rag_interactions
      where ${clauses.join(" and ")}
      order by created_at desc
      limit $${values.length}
    `,
    values,
  );

  return rows.map(toHistoryItem);
}
