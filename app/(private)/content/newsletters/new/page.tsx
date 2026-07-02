import { ContentManagementPlaceholder } from "@/components/content-management-placeholder";

export default function Page() {
  return (
    <ContentManagementPlaceholder
      eyebrow="Content / Newsletters"
      title="Create newsletter"
      description="Create a newsletter archive draft for the public site."
      checklist={[
        "Capture title, subject, preview text, body, and related resources.",
        "Save locally before Mailchimp integration is added.",
        "Publish to the website archive before any future campaign sync.",
      ]}
      notes={["Mailchimp actions will be explicit and audited."]}
    />
  );
}
