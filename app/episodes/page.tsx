import { TopRail } from "@/components/top-rail";
import { RoutePanel } from "@/components/route-panel";

export default function PublicEpisodesPage() {
  return (
    <>
      <TopRail variant="public" />
      <main className="public-shell">
        <RoutePanel
          eyebrow="Public archive"
          title="Episodes"
          aside={<p className="note">Public episode rows will use approved metadata only.</p>}
        >
          <div className="empty-state">
            <strong>Public episode index shell</strong>
            <span>Phase 1 keeps public browsing safe and minimal. Real public data policy comes after the private console MVP.</span>
          </div>
        </RoutePanel>
      </main>
    </>
  );
}
