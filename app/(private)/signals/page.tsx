import { RoutePanel } from "@/components/route-panel";

export default function SignalsPage() {
  return (
    <RoutePanel
      eyebrow="Signals"
      title="Stats workspace"
      aside={<p className="note">Episode-by-country values are not exact in the current import and must not be shown as exact.</p>}
    >
      <div className="empty-state">
        <strong>Podtrac reporting shell</strong>
        <span>Phase 3 will add the verified clean-window total of 118,626 downloads and linked top-episode rows.</span>
      </div>
    </RoutePanel>
  );
}
