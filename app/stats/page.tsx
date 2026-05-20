import Link from "next/link";

import { RoutePanel } from "@/components/route-panel";
import { TopRail } from "@/components/top-rail";

export default function PublicStatsPage() {
  return (
    <>
      <TopRail variant="public" />
      <main className="public-shell">
        <RoutePanel
          eyebrow="Listenership"
          title="Podcast statistics are private"
          aside={<p className="note">Audience metrics, Podtrac tables, and pipeline signals are available inside the protected console.</p>}
        >
          <section className="split-board">
            <div>
              <p className="eyebrow">Protected data</p>
              <h2>Stats require console access</h2>
              <p>
                Public visitors can browse episodes, listen to audio, read transcripts, and ask source-backed archive questions.
                Download totals and audience breakdowns stay behind sign-in because they include private Podtrac data.
              </p>
            </div>
            <div className="status-list status-list--compact">
              <span>
                <strong>Public archive</strong>
                Episode search, audio links, transcripts, and RAG sources.
              </span>
              <span>
                <strong>Private Signals</strong>
                Podtrac downloads, matched rows, countries, clients, and trend tables.
              </span>
              <Link className="button button--primary" href="/signals">
                Open Signals
              </Link>
            </div>
          </section>
        </RoutePanel>
      </main>
    </>
  );
}
