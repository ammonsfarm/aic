import { RoutePanel } from "@/components/route-panel";

export default function ComposePage() {
  return (
    <RoutePanel
      eyebrow="Compose"
      title="Source-backed drafting desk"
      aside={<p className="note">Drafts must be labeled as newly generated material informed by selected sources.</p>}
    >
      <div className="compose-grid">
        {["Sermon draft", "Article draft", "Bible study plan", "Devotional series", "TTS-safe manuscript"].map((workflow) => (
          <button className="workflow-button" key={workflow} type="button">
            {workflow}
          </button>
        ))}
      </div>
      <div className="preview-surface">
        <p className="eyebrow">Preview</p>
        <p>Select sources, passage, tone, and output length after the retrieval layer is available.</p>
      </div>
    </RoutePanel>
  );
}
