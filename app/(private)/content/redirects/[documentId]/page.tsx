import StructuredEntryEditorPage from "../../structured/[collection]/[documentId]/page";

export const dynamic = "force-dynamic";

export default async function FriendlyStructuredEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { documentId } = await params;
  return StructuredEntryEditorPage({
    params: Promise.resolve({ collection: "redirects", documentId }),
    searchParams,
  });
}
