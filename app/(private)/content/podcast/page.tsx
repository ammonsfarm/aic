import { ContentManagementPlaceholder } from "@/components/content-management-placeholder";

export default function ContentPodcastPage() {
  return (
    <ContentManagementPlaceholder
      eyebrow="Content / Podcast"
      title="Radio and MP3 uploads"
      description="Manage MP3 uploads, episode metadata, processing handoff, and public archive publishing."
      primaryAction={{ href: "/content/podcast/new", label: "New upload" }}
      checklist={[
        "List uploads by title, program date, audio status, transcript status, and publish state.",
        "Store MP3 files in MinIO for the first release.",
        "Allow future migration to R2 or another object store without changing editor workflow.",
      ]}
      notes={[
        "Do not run long transcription or vector work inside a web request.",
        "Public episode appears only after direct publish.",
      ]}
    />
  );
}
