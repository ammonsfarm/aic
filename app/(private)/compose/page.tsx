import { RoutePanel } from "@/components/route-panel";
import { ComposeWorkbench } from "@/components/compose-workbench";

export default function ComposePage() {
  return (
    <RoutePanel
      eyebrow="Compose"
      title="Source-backed drafting desk"
      aside={
        <p className="note">
          Use search-grounded RAG context to draft sermon outlines, lesson plans, and devotional material.
        </p>
      }
    >
      <p className="note" style={{ marginTop: 0 }}>
        This workbench sends your request to the same RAG-backed assistant used across the site so drafts are grounded in indexed transcripts and intelligence.
      </p>
      <ComposeWorkbench />
    </RoutePanel>
  );
}
