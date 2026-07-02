import { ContentManagementPlaceholder } from "@/components/content-management-placeholder";

export default async function ContentPodcastDetail({ params }: { params: Promise<{ episodeId: string }> }) {
  const { episodeId } = await params;

  return (
    <ContentManagementPlaceholder
      eyebrow="Content / Podcast"
      title={`Podcast editor: ${episodeId}`}
      description="Edit uploaded episode metadata, review audio status, request processing, and publish to the public archive."
      checklist={[
        "Load audio asset, metadata, and processing status.",
        "Edit title, slug, description, date, series, scripture references, and guests.",
        "Publish the episode after metadata and audio are ready.",
      ]}
      notes={[
        "MP3 files use MinIO for the first release.",
        "Processing jobs must run outside the web request.",
      ]}
    />
  );
}
