import { ContentManagementPlaceholder } from "@/components/content-management-placeholder";

export default function Page() {
  return (
    <ContentManagementPlaceholder
      eyebrow="Content / Podcast"
      title="Create upload"
      description="Add a new MP3 upload and prepare its public archive metadata."
      checklist={[
        "Upload MP3 audio to MinIO.",
        "Capture title, slug, date, summary, category, scripture references, and guest names.",
        "Request transcript, intelligence, and vector processing after metadata is saved.",
      ]}
      notes={["Processing should be handed off to background workers."]}
    />
  );
}
