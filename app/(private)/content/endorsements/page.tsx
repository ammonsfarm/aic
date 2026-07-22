import StructuredCollectionPage from "../structured/[collection]/page";

export const dynamic = "force-dynamic";

export default function FriendlyStructuredCollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  return StructuredCollectionPage({
    params: Promise.resolve({ collection: "endorsements" }),
    searchParams,
  });
}
