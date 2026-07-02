import { ContentManagementPlaceholder } from "@/components/content-management-placeholder";

export default function ContentNewslettersPage() {
  return (
    <ContentManagementPlaceholder
      eyebrow="Content / Newsletters"
      title="Newsletter archive"
      description="Manage newsletter drafts and public archive entries before adding optional Mailchimp campaign sync."
      primaryAction={{ href: "/content/newsletters/new", label: "New newsletter" }}
      checklist={[
        "List newsletters by subject, archive status, Mailchimp status, and scheduled date.",
        "Publish newsletters to the website archive.",
        "Add explicit Mailchimp campaign sync later.",
      ]}
      notes={[
        "Mailchimp sending must remain explicit and audited.",
        "Local archive comes first.",
      ]}
    />
  );
}
