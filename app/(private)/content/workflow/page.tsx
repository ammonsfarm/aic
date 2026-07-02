import { ContentManagementPlaceholder } from "@/components/content-management-placeholder";

export default function ContentWorkflowPage() {
  return (
    <ContentManagementPlaceholder
      eyebrow="Content / Workflow"
      title="Publishing workflow"
      description="Track drafts, scheduled content, published content, archived content, and audit events across the CMS."
      checklist={[
        "Show draft, scheduled, published, and archived content in one place.",
        "Track direct publish, schedule, archive, and rollback actions.",
        "Surface failed podcast processing jobs and newsletter sync issues when those integrations exist.",
      ]}
      notes={[
        "No approval workflow is required for the first release.",
        "Audit history should still be recorded for important actions.",
      ]}
    />
  );
}
