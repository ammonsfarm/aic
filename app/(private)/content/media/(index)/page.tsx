import StructuredCollectionPage from "../../structured/[collection]/page";

export const dynamic = "force-dynamic";

export default function MediaLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  return StructuredCollectionPage({
    params: Promise.resolve({ collection: "media-assets" }),
    searchParams,
  });
}
