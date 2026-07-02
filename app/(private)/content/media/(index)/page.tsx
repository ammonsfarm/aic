import { ContentManagementPlaceholder } from "@/components/content-management-placeholder";

export default function Page() {
  return (
    <ContentManagementPlaceholder
      eyebrow="Content / Media"
      title="Media library"
      description="Manage reusable images, documents, downloads, and audio assets for the public site."
      primaryAction={{ href: "/content/media/new", label: "Upload media" }}
      checklist={[
        "List assets with filename, type, size, status, and usage notes.",
        "Store metadata in Postgres and files in the selected storage location.",
        "Support alt text, captions, attribution, and visibility status.",
      ]}
      notes={[
        "Podcast MP3 files initially use MinIO.",
        "Future storage migration should not change the editor workflow.",
      ]}
    />
  );
}
