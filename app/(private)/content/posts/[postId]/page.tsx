import { ContentManagementPlaceholder } from "@/components/content-management-placeholder";

export default async function ContentPostDetail({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;

  return (
    <ContentManagementPlaceholder
      eyebrow="Content / Posts"
      title={`Writing editor: ${postId}`}
      description="Edit the selected writing draft, preview it, schedule it, publish it directly, or archive it."
      checklist={[
        "Load draft and published versions for the selected writing.",
        "Edit body content, metadata, scripture references, tags, and related resources.",
        "Record revision history and audit entries for saves and publishing actions.",
      ]}
      notes={[
        "Historical imports should auto-publish during migration.",
        "Content Manager can publish directly in the first release.",
      ]}
    />
  );
}
