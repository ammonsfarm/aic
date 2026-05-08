import { RoutePanel } from "@/components/route-panel";

export default function PipelinePage() {
  return (
    <RoutePanel
      eyebrow="Pipeline"
      title="Ingestion and sync console"
      aside={<p className="note">Read-only status comes first. Actions should not pretend to trigger jobs until a runner is wired.</p>}
    >
      <div className="status-list status-list--wide">
        {["Transcript coverage", "Speech vectors", "Episode intelligence", "Intelligence vectors", "Podtrac sync", "Unmatched records"].map((label) => (
          <span key={label}>
            <strong>{label}</strong>
            Pending live count
          </span>
        ))}
      </div>
    </RoutePanel>
  );
}
