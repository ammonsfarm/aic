import StructuredEntryPreviewPage from "../../../structured/[collection]/[documentId]/preview/page";

export const dynamic = "force-dynamic";

export default async function ContentPostPreview({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  return StructuredEntryPreviewPage({
    params: Promise.resolve({ collection: "posts", documentId: postId }),
  });
}
