import { EpisodeSearchPanel } from "@/components/episode-search";
import { TopRail } from "@/components/top-rail";
import { RoutePanel } from "@/components/route-panel";
import { RagChatWidget } from "@/components/rag-chat-widget";
import { getEpisodeArchiveRows } from "@/lib/podcast-insights";
import { searchEpisodesWithVectorFallback, type EpisodeSearchScope } from "@/lib/podcast-data";

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

export default async function PublicEpisodesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mode?: SearchMode; top_k?: string; scope?: EpisodeSearchScope }>;
}) {
  const { q, mode, top_k, scope } = await searchParams;
  const query = q?.trim() ?? "";
  const parsedMode = parseMode(mode);
  const topK = parseTopK(top_k, 20);
  const parsedScope = parseScope(scope);
  const rows = query && parsedMode === "hybrid"
    ? await searchEpisodesWithVectorFallback(query, { limit: topK + 20, scope: parsedScope })
    : await getEpisodeArchiveRows({ query, limit: topK + 20, scope: parsedScope });

  return (
    <>
      <TopRail variant="public" />
      <main className="public-shell">
        <RoutePanel
          eyebrow="Episode archive"
          title="Search and browse all episodes"
        aside={<p className="note">Use text-only mode for exact name/metadata matching, or hybrid for transcript and RAG-aware results.</p>}
      >
          <EpisodeSearchPanel
            defaultQuery={query}
            defaultMode={parsedMode}
            defaultScope={parsedScope}
            defaultTopK={topK}
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
          <RagChatWidget
            action="/api/rag/chat"
            heading="Archive RAG chat"
            description="Ask about scripture, topics, guests, sermon illustrations, or repeated themes across episodes."
            submitLabel="Ask archive"
            sourceLabel="Retrieved sources"
            historyScope="archive"
          />
        </RoutePanel>
      </main>
    </>
  );
}
