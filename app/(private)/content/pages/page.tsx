import { ContentManagementPlaceholder } from "@/components/content-management-placeholder";

export default function ContentPagesPage() {
  return (
    <ContentManagementPlaceholder
      eyebrow="Content / Pages"
      title="Site pages"
      description="Manage evergreen public pages such as Home, About, Radio, Contact, Donate, Board, Endorsements, and Privacy."
      primaryAction={{ href: "/content/pages/new", label: "New page" }}
      checklist={[
        "List public pages with status, slug, last update, and publish date.",
        "Open a page editor with draft, schedule, publish, archive, and revision history actions.",
        "Render public pages from published CMS records only.",
      ]}
      notes={[
        "First candidate for CMS conversion: /about-pastor-wood.",
        "No approval workflow for first release.",
      ]}
    />
  );
}
