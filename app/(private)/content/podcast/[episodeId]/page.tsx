import StructuredEntryEditorPage from "../../structured/[collection]/[documentId]/page";

export const dynamic = "force-dynamic";

export default async function ContentPodcastDetail({
  params,
  searchParams,
}: {
  params: Promise<{ episodeId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { episodeId } = await params;
  return StructuredEntryEditorPage({
    params: Promise.resolve({ collection: "episodes", documentId: episodeId }),
    searchParams,
  });
}
