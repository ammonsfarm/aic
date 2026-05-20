import { RoutePanel } from "@/components/route-panel";
import { getPipelineRuns } from "@/lib/podcast-insights";
import { getPodtracDashboard } from "@/lib/podcast-data";

function formatDate(value: string | null) {
  if (!value) {
    return "In progress";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusClass(status: string) {
  if (status.includes("fail") || status.includes("error") || status.includes("retry")) {
    return "status-item status-item--warn";
  }

  if (status.includes("running")) {
    return "status-item status-item--active";
  }

  return "status-item";
}

export default async function PipelinePage() {
  const [runs, dashboard] = await Promise.all([getPipelineRuns(18), getPodtracDashboard()]);

  return (
    <RoutePanel
      eyebrow="Pipeline"
      title="Ingestion and sync console"
      aside={<p className="note">Read-only control plane for now. Add actions once runner orchestration endpoints are added.</p>}
    >
      <section className="split-board split-board--wide">
        <div>
          <p className="eyebrow">Health snapshot</p>
          <h2>Corpus and listenership readiness</h2>
          <div className="status-list">
            <span><strong>Episodes</strong> {dashboard.counts.episodes}</span>
            <span><strong>Transcript chunks</strong> {dashboard.counts.transcriptChunks}</span>
            <span><strong>Speech vectors</strong> {dashboard.counts.speechVectors}</span>
            <span><strong>Intelligence rows</strong> {dashboard.counts.intelligenceRows}</span>
            <span><strong>Intelligence vectors</strong> {dashboard.counts.intelligenceVectors}</span>
            <span><strong>Podtrac matched episodes</strong> {dashboard.counts.podtracMatched}</span>
          </div>
        </div>
        <div>
          <p className="eyebrow">Known data quality</p>
          <h2>Warnings and coverage notes</h2>
          <div className="status-list">
            <span>
              <strong>Unmatched podtrac rows</strong>
              {dashboard.counts.podtracUnmatched}
            </span>
            <span>
              <strong>Indexed downloads</strong>
              {dashboard.counts.totalDownloads}
            </span>
            <span>
              <strong>Country rows loaded</strong>
              {dashboard.counts.podtracCountryRows}
            </span>
            <span>
              <strong>Client rows loaded</strong>
              {dashboard.counts.podtracClientRows}
            </span>
          </div>
        </div>
      </section>

      <section className="split-board">
        <div>
          <p className="eyebrow">Pipeline history</p>
          <h2>Latest pipeline run rows</h2>
          <div className="status-list">
            {runs.length === 0 ? <p className="note">No pipeline rows found yet.</p> : null}
            {runs.map((run) => (
              <span key={`${run.source}-${run.completedAt ?? run.startedAt}`} className={statusClass(run.status)}>
                <strong>{run.source}</strong>
                {run.status}
                <br />
                <span className="note">{formatDate(run.completedAt ?? run.startedAt)} · {run.error || "OK"}</span>
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="eyebrow">Run expectations</p>
          <h2>Suggested operator steps</h2>
          <div className="status-list status-list--compact">
            <span><strong>1.</strong> RSS + MP3 catalog ingestion from latest feed sync</span>
            <span><strong>2.</strong> Transcription/normalization and transcript chunking</span>
            <span><strong>3.</strong> Transcript embedding and speech similarity indexing</span>
            <span><strong>4.</strong> Intelligence summary/vector generation</span>
            <span><strong>5.</strong> Podtrac sync and match reconciliation</span>
            <span><strong>6.</strong> Re-run this page to validate row movement</span>
          </div>
        </div>
      </section>
    </RoutePanel>
  );
}
