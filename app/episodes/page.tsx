import { EpisodeSearchPanel } from "@/components/episode-search";
import { TopRail } from "@/components/top-rail";
import { RoutePanel } from "@/components/route-panel";
import { RagChatWidget } from "@/components/rag-chat-widget";
import { requireInternalReadConsoleUser } from "@/lib/console-access";
import { getEpisodeArchiveRows } from "@/lib/podcast-insights";
import { searchEpisodesWithVectorFallback, type EpisodeSearchScope, type EpisodeSortOrder } from "@/lib/podcast-data";
import { canGenerateForRole } from "@/lib/rbac";

type SearchMode = "text" | "hybrid";

type EpisodeRow = Awaited<ReturnType<typeof getEpisodeArchiveRows>>[number];

export const dynamic = "force-dynamic";

function parseTopK(value: string | undefined, fallback = 20) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(parsed), 80);
}

function parseMode(value: string | undefined): SearchMode {
  return value === "text" ? "text" : "hybrid";
}

function parseScope(value: string | undefined): EpisodeSearchScope {
  if (value === "title" || value === "passage" || value === "guest" || value === "interview" || value === "theme") {
    return value;
  }

  return "all";
}

function parseDateFilter(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

function parseSort(value: string | undefined): EpisodeSortOrder {
  if (value === "date_desc" || value === "date_asc" || value === "title_asc") {
    return value;
  }

  return "relevance";
}

function cleanPublicSnippet(value: string) {
  return value
    .split(/\r?\n/)
    .filter((line) => !/^(Episode:|Track ID:|Publish Date:|Time Range:)\s*/i.test(line.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function toPublicSearchRow(row: EpisodeRow) {
  return {
    trackId: row.trackId,
    title: row.title,
    publishDate: row.publishDate,
    album: row.album,
    category: row.category,
    detail: row.detail,
    score: row.score,
    hitTypes: row.hitTypes,
    snippet: cleanPublicSnippet(row.snippet),
  };
}

export default async function EpisodesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    mode?: SearchMode;
    top_k?: string;
    scope?: EpisodeSearchScope;
    date_start?: string;
    date_end?: string;
    sort?: EpisodeSortOrder;
  }>;
}) {
  const { q, mode, top_k, scope, date_start, date_end, sort } = await searchParams;
  const query = q?.trim() ?? "";
  const parsedMode = parseMode(mode);
  const topK = parseTopK(top_k, 20);
  const parsedScope = parseScope(scope);
  const dateStart = parseDateFilter(date_start);
  const dateEnd = parseDateFilter(date_end);
  const parsedSort = parseSort(sort);
  const appUser = await requireInternalReadConsoleUser();
  const rows = query && parsedMode === "hybrid"
    ? await searchEpisodesWithVectorFallback(query, {
        limit: topK + 20,
        scope: parsedScope,
        dateStart,
        dateEnd,
        sort: parsedSort,
      })
    : await getEpisodeArchiveRows({
        query,
        limit: topK + 20,
        scope: parsedScope,
        dateStart,
        dateEnd,
        sort: parsedSort,
      });

  return (
    <>
      <TopRail variant="private" role={appUser.role} />
      <main className="public-shell" id="main-content" tabIndex={-1}>
        <RoutePanel
          eyebrow="AIC Episodes"
          title="Search and browse all episodes"
        >
          <EpisodeSearchPanel
            defaultQuery={query}
            defaultMode={parsedMode}
            defaultScope={parsedScope}
            defaultTopK={topK}
            defaultDateStart={dateStart}
            defaultDateEnd={dateEnd}
            defaultSort={parsedSort}
            detailBasePath="/episodes"
            initialRows={rows.map(toPublicSearchRow)}
            initialTotal={rows.length}
          />
        </RoutePanel>

        <RoutePanel
          eyebrow="Ask the archive"
          title="Source-backed corpus chat"
          aside={<p className="note">Answers are grounded in retrieved transcript and summary context from the indexed episode archive.</p>}
        >
          {canGenerateForRole(appUser.role) ? (
            <RagChatWidget
              action="/api/rag/chat"
              heading="Archive RAG chat"
              description="Ask about scripture, topics, guests, sermon illustrations, or repeated themes across episodes."
              submitLabel="Ask archive"
              sourceLabel="Retrieved sources"
              historyScope="archive"
            />
          ) : (
            <p className="empty-state" role="status">
              Archive questions are not available for your role. You can still search and browse episode records above.
            </p>
          )}
        </RoutePanel>
      </main>
    </>
  );
}
