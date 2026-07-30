import { RoutePanel } from "@/components/route-panel";
import { DataFreshnessNotice, SuccessfulCheckFreshnessNotice } from "@/components/data-freshness";
import { PipelineOperations } from "@/components/pipeline-operations";
import { getOperationalDashboard, listMatchedPodtracEpisodes, listUnmatchedPodtracEpisodes } from "@/lib/admin-operations";
import { requireInternalReadConsoleUser } from "@/lib/console-access";
import { getPodtracDashboard } from "@/lib/podcast-data";
import { addReportDays } from "@/lib/podcast-reporting";
import { isCurrentUserAdministrator } from "@/lib/rbac";

function formatDate(value: string | null) {
  if (!value) {
    return "In progress";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value === "infinity" ? "No automatic retry" : value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
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

export const dynamic = "force-dynamic";

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireInternalReadConsoleUser();
  const params = await searchParams;
  const query = params.q?.trim().slice(0, 120) ?? "";
  const [operations, dashboard, unmatched, matched, isAdministrator] = await Promise.all([
    getOperationalDashboard({ limit: 20 }),
    getPodtracDashboard(),
    listUnmatchedPodtracEpisodes({ query, limit: 20 }),
    listMatchedPodtracEpisodes({ query, limit: 20 }),
    isCurrentUserAdministrator(),
  ]);
  const exportToday = operations.generatedAt.slice(0, 10);
  const exportStart = addReportDays(exportToday, -29);

  return (
    <RoutePanel
      eyebrow="Pipeline"
      title="Ingestion and sync console"
      aside={<p className="note">Authoritative ingest, Podtrac and transcript worker state. Retry controls enqueue fixed background jobs for administrators.</p>}
    >
      <section className="split-board split-board--wide">
        <SuccessfulCheckFreshnessNotice label="Daily ingest" freshness={operations.freshness.ingest} />
        <DataFreshnessNotice label="Podtrac reporting" freshness={operations.freshness.podtrac} />
        <article className={operations.podtracAuth.state === "auth-error" ? "status-card status-item status-item--warn" : "status-card status-item"} role={operations.podtracAuth.state === "auth-error" ? "alert" : "status"}>
          <h3 className="status-card__title">Podtrac authentication: {operations.podtracAuth.state}</h3>
          <p className="status-card__detail">{operations.podtracAuth.message}</p>
          <p className="status-card__meta">{operations.podtracAuth.checkedAt ? `Runner log checked ${formatDate(operations.podtracAuth.checkedAt)}.` : "No runner log timestamp."}</p>
        </article>
      </section>
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
            {operations.runs.length === 0 ? <p className="note">No authoritative pipeline rows found yet.</p> : null}
            {operations.runs.map((run) => (
              <span key={`${run.source}-${run.id}`} className={statusClass(`${run.status} ${run.error}`.toLowerCase())}>
                <strong>{run.source}</strong>
                {run.status} · {run.stage}
                <br />
                <span className="note">
                  {formatDate(run.completedAt ?? run.startedAt)}
                  {run.source === "podtrac-import" ? ` · data through ${run.dataCurrentThrough ?? "unknown"}` : ""}
                  {` · ${run.error || "OK"}`}
                </span>
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="eyebrow">Transcript edit worker</p>
          <h2>Correction queue state</h2>
          <div className="status-list status-list--compact">
            {Object.entries(operations.transcript.counts).map(([status, count]) => (
              <span key={status} className={statusClass(status)}><strong>{status}</strong>{count}</span>
            ))}
            <span><strong>Latest update</strong>{formatDate(operations.transcript.latestUpdate)}</span>
          </div>
          <h3>Recent correction state</h3>
          <div className="status-list status-list--compact">
            {operations.transcript.recent.slice(0, 8).map((edit) => (
              <span
                key={edit.id}
                className={statusClass(`${edit.status} ${edit.terminalEdit || edit.terminalRevectorization ? "failure" : ""}`)}
              >
                <strong>{edit.episodeTitle}</strong>
                {edit.status}{edit.needsRevectorization ? " · vector update pending" : ""}
                <small>
                  Edit attempts {edit.attemptCount}; vector attempts {edit.revectorizationAttemptCount}. {edit.terminalEdit || edit.terminalRevectorization
                    ? "Admin retry required."
                    : `Next eligible ${formatDate(edit.needsRevectorization ? edit.nextRevectorizationAt : edit.nextAttemptAt)}.`}
                  {edit.error ? ` ${edit.error}` : ""}
                </small>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="split-board split-board--wide">
        <div>
          <p className="eyebrow">Stage detail</p>
          <h2>Latest ingest stage events</h2>
          <div className="status-list status-list--compact">
            {operations.stageEvents.slice(0, 24).map((event) => (
              <span key={event.id} className={statusClass(`${event.status} ${event.error}`.toLowerCase())}>
                <strong>{event.stage}</strong>{event.status} · run {event.runId}
                <small>{formatDate(event.completedAt ?? event.startedAt)} · {event.error || "OK"}</small>
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="eyebrow">Queued handoff</p>
          <h2>Retry request history</h2>
          <div className="status-list status-list--compact">
            {operations.retries.length === 0 ? <p className="note">No retry requests yet.</p> : null}
            {operations.retries.map((retry) => (
              <span key={retry.id} className={statusClass(`${retry.status} ${retry.error}`.toLowerCase())}>
                <strong>{retry.stage}</strong>{retry.status}
                <small>{formatDate(retry.completedAt ?? retry.startedAt ?? retry.requestedAt)} · {retry.error || retry.outputSummary || retry.reason || "No note"}</small>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="podcast-chart-section">
        <div className="chart-section-head">
          <div><p className="eyebrow">Reconciliation search</p><h2>Find unmatched Podtrac episodes</h2></div>
          <form className="range-form" method="get">
            <label><span>Title or Podtrac id</span><input name="q" defaultValue={query} /></label>
            <button className="button button--ghost" type="submit">Search</button>
          </form>
        </div>
        {isAdministrator ? (
          <div className="podcast-subnav">
            <a className="button button--ghost" href={`/api/admin/podcast/export?report=unmatched&startDate=${exportToday.slice(0, 4)}-01-01&endDate=${exportToday}`}>Export unmatched CSV</a>
            <a className="button button--ghost" href={`/api/admin/podcast/export?report=pipeline&startDate=${exportStart}&endDate=${exportToday}`}>Export all pipeline events CSV</a>
            <a className="button button--ghost" href={`/api/admin/podcast/export?report=transcript-edits&startDate=${exportStart}&endDate=${exportToday}`}>Export transcript CSV</a>
          </div>
        ) : null}
      </section>

      <PipelineOperations isAdministrator={isAdministrator} unmatched={unmatched} matched={matched} />

      {isAdministrator && operations.audit.length > 0 ? (
        <section className="podcast-chart-section">
          <p className="eyebrow">Administrative audit</p>
          <h2>Recent operational changes</h2>
          <div className="status-list status-list--compact">
            {operations.audit.map((event) => (
              <span key={event.id}><strong>{event.action}</strong>{event.entityType} {event.entityId}<small>{formatDate(event.createdAt)} by {event.actorEmail}</small></span>
            ))}
          </div>
        </section>
      ) : null}
    </RoutePanel>
  );
}
