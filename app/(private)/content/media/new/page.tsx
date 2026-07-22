import StructuredNewEntryPage from "../../structured/[collection]/new/page";

export const dynamic = "force-dynamic";

export default function NewMediaAssetPage() {
  return StructuredNewEntryPage({
    params: Promise.resolve({ collection: "media-assets" }),
  });
}
