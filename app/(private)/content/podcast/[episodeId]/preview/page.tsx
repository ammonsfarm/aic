import StructuredEntryPreviewPage from "../../../structured/[collection]/[documentId]/preview/page";

export const dynamic = "force-dynamic";

export default async function ContentEpisodePreview({
  params,
}: {
  params: Promise<{ episodeId: string }>;
}) {
  const { episodeId } = await params;
  return StructuredEntryPreviewPage({
    params: Promise.resolve({ collection: "episodes", documentId: episodeId }),
  });
}
