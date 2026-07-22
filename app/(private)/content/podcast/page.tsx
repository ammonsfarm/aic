import StructuredCollectionPage from "../structured/[collection]/page";

export const dynamic = "force-dynamic";

export default async function ContentPodcastPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  return StructuredCollectionPage({
    params: Promise.resolve({ collection: "episodes" }),
    searchParams,
  });
}
