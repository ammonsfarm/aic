import StructuredEntryEditorPage from "../../structured/[collection]/[documentId]/page";

export const dynamic = "force-dynamic";

export default async function ContentPostDetail({
  params,
  searchParams,
}: {
  params: Promise<{ postId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { postId } = await params;
  return StructuredEntryEditorPage({
    params: Promise.resolve({ collection: "posts", documentId: postId }),
    searchParams,
  });
}
