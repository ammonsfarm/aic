import StructuredEntryPreviewPage from "../../../structured/[collection]/[documentId]/preview/page";

export const dynamic = "force-dynamic";

export default async function FriendlyStructuredPreviewPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  return StructuredEntryPreviewPage({
    params: Promise.resolve({ collection: "endorsements", documentId }),
  });
}
