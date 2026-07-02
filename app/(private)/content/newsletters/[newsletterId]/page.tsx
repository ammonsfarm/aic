import { ContentManagementPlaceholder } from "@/components/content-management-placeholder";

export default async function ContentNewsletterDetail({ params }: { params: Promise<{ newsletterId: string }> }) {
  const { newsletterId } = await params;

  return (
    <ContentManagementPlaceholder
      eyebrow="Content / Newsletters"
      title={`Newsletter editor: ${newsletterId}`}
      description="Edit the selected newsletter archive draft, schedule it, publish it locally, or prepare a future Mailchimp handoff."
      checklist={[
        "Load subject, preview text, body, related resources, and archive status.",
        "Save draft and publish to the public archive directly.",
        "Store Mailchimp campaign information only after integration is configured.",
      ]}
      notes={[
        "Website archive publishing does not imply email sending.",
        "Mailchimp send actions should require explicit confirmation later.",
      ]}
    />
  );
}
