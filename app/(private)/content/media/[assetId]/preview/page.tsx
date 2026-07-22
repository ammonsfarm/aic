import StructuredEntryPreviewPage from "../../../structured/[collection]/[documentId]/preview/page";

export const dynamic = "force-dynamic";

export default async function MediaAssetPreview({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  const { assetId } = await params;
  return StructuredEntryPreviewPage({
    params: Promise.resolve({ collection: "media-assets", documentId: assetId }),
  });
}
