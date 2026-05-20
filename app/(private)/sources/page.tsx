import Link from "next/link";

import { RoutePanel } from "@/components/route-panel";
import { getSourceBrowserData } from "@/lib/podcast-insights";

function formatText(value: string) {
  if (!value) {
    return "No text available";
  }

  return value;
}

export default async function SourcesPage() {
  const data = await getSourceBrowserData();

  return (
    <RoutePanel
      eyebrow="Sources"
      title="Intelligence source browser"
      aside={<p className="note">Review corpus artifacts and inspect where each result was derived.</p>}
    >
      <section className="split-board split-board--wide">
        <div>
          <p className="eyebrow">Intelligence item types</p>
          <h2>Latest intelligence extraction by lane</h2>
          <div className="status-list">
            {data.intelligenceItemTypes.length === 0 ? <p className="note">No item-type rows found yet.</p> : null}
            {data.intelligenceItemTypes.map((row) => (
              <span key={`${row.type}-${row.count}`}>
                <strong>{row.type}</strong>
                {row.count}
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="eyebrow">Transcript sources</p>
          <h2>Recent transcript chunks</h2>
          <div className="status-list">
            {data.recentTranscriptSamples.length === 0 ? <p className="note">No transcript chunks found.</p> : null}
            {data.recentTranscriptSamples.slice(0, 8).map((row) => (
              <article key={`${row.trackId}-${row.customId}`} className="source-card">
                <div className="source-card__head">
                  <p>
                    <strong>{row.title || "Episode"}</strong>
                  </p>
                  <span>{row.startTime}–{row.endTime}</span>
                </div>
                <p className="note">Track {row.trackId}</p>
                <p>{formatText(row.text)}</p>
                <Link className="button button--ghost" href={`/episodes/${row.trackId}`}>
                  Open episode
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="split-board">
        <div>
          <p className="eyebrow">Intelligence item samples</p>
          <h2>Story, scripture, and segment highlights</h2>
          <div className="status-list">
            {data.recentIntelligenceItemSamples.length === 0 ? <p className="note">No intelligence samples yet.</p> : null}
            {data.recentIntelligenceItemSamples.slice(0, 10).map((item) => (
              <article key={`${item.id}-${item.itemType}`} className="source-card">
                <p>
                  <strong>{item.itemType}</strong> · {item.label}
                </p>
                <p className="note">{item.trackId} · {item.title}</p>
                <p>{formatText(item.summary)}</p>
              </article>
            ))}
          </div>
        </div>
        <div>
          <p className="eyebrow">Intelligence vector samples</p>
          <h2>Semantic chunks with lane labels</h2>
          <div className="status-list">
            {data.recentIntelligenceVectorSamples.length === 0 ? <p className="note">No vector samples yet.</p> : null}
            {data.recentIntelligenceVectorSamples.slice(0, 10).map((row) => (
              <article key={`${row.customId}-${row.vectorType}`} className="source-card">
                <p>
                  <strong>{row.vectorType}</strong>
                </p>
                <p className="note">{row.trackId} · {row.title}</p>
                <p>
                  {row.label ? `${row.label} — ` : ""}
                  {formatText(row.text)}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </RoutePanel>
  );
}
