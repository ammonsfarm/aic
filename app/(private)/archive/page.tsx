import { RoutePanel } from "@/components/route-panel";

export default function ArchivePage() {
  return (
    <RoutePanel
      eyebrow="Archive"
      title="Episode research table"
      aside={<p className="note">Filters will cover date, transcript, intelligence, and Podtrac link status once the data layer is connected.</p>}
    >
      <div className="toolbar-row">
        <input aria-label="Search episodes" placeholder="Search episodes, scripture, people, or topics" disabled />
        <button className="button button--ghost" type="button" disabled>Filters</button>
      </div>
      <div className="empty-state">
        <strong>No episode rows loaded yet</strong>
        <span>Phase 4 will replace this with real Postgres episode rows and detail links.</span>
      </div>
    </RoutePanel>
  );
}
