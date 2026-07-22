import StructuredEntryEditorPage from "../../structured/[collection]/[documentId]/page";

export const dynamic = "force-dynamic";

export default async function MediaAssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ assetId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { assetId } = await params;
  return StructuredEntryEditorPage({
    params: Promise.resolve({ collection: "media-assets", documentId: assetId }),
    searchParams,
  });
}
