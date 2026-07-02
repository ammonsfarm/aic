import { ContentManagementPlaceholder } from "@/components/content-management-placeholder";

export default function ContentPostsPage() {
  return (
    <ContentManagementPlaceholder
      eyebrow="Content / Posts"
      title="Posts and writings"
      description="Manage devotionals, written resources, Bible studies, imported Pastor Wood posts, and new article drafts."
      primaryAction={{ href: "/content/posts/new", label: "New post" }}
      checklist={[
        "List posts by type, status, publish date, author, and topic tags.",
        "Create and edit rich post drafts with scripture references and related episodes.",
        "Auto-publish historical WordPress imports during migration unless an import issue is detected.",
      ]}
      notes={[
        "Existing Pastor Wood post tables can be reused or bridged into a normalized CMS layer.",
        "No approval workflow for first release.",
      ]}
    />
  );
}
