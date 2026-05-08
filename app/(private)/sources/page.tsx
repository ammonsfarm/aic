import { RoutePanel } from "@/components/route-panel";

export default function SourcesPage() {
  return (
    <RoutePanel
      eyebrow="Sources"
      title="Intelligence browser"
      aside={<p className="note">Source drawers must expose episode, timestamp, speaker, retrieval lane, and tool usage.</p>}
    >
      <div className="source-lanes">
        {["Transcript vectors", "Intelligence vectors", "Corpus discovery", "Full sermon context", "Bible passage"].map((lane) => (
          <div className="lane-row" key={lane}>
            <strong>{lane}</strong>
            <span>Pending server wiring</span>
          </div>
        ))}
      </div>
    </RoutePanel>
  );
}
