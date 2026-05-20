import { EpisodeSearchPanel } from "@/components/episode-search";
import { RoutePanel } from "@/components/route-panel";
import { getEpisodeArchiveRows } from "@/lib/podcast-insights";
import { searchEpisodesWithVectorFallback, type EpisodeSearchScope } from "@/lib/podcast-data";

type SearchMode = "text" | "hybrid";

function parseTopK(value: string | undefined, fallback = 40) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.trunc(parsed), 120);
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

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mode?: SearchMode; top_k?: string; scope?: EpisodeSearchScope }>;
}) {
  const { q, mode, top_k, scope } = await searchParams;
  const query = q?.trim() ?? "";
  const parsedMode = parseMode(mode);
  const topK = parseTopK(top_k, 40);
  const parsedScope = parseScope(scope);
  const initialRows = query && parsedMode === "hybrid"
    ? await searchEpisodesWithVectorFallback(query, { limit: topK + 20, scope: parsedScope })
    : await getEpisodeArchiveRows({ query, limit: topK + 20, scope: parsedScope });

  return (
    <RoutePanel
      eyebrow="Archive"
      title="Episode research table"
      aside={
        <p className="note">
          Internal archive search supports metadata, transcript snippets, intelligence labels, and source-vector matching.
        </p>
      }
    >
      <EpisodeSearchPanel
        endpoint="/api/episodes/search"
        detailBasePath="/episodes"
        defaultQuery={query}
        defaultMode={parsedMode}
        defaultScope={parsedScope}
        defaultTopK={topK}
        initialRows={initialRows}
        initialTotal={initialRows.length}
        showInternalStatus
      />
    </RoutePanel>
  );
}
