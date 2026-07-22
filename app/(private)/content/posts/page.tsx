import StructuredCollectionPage from "../structured/[collection]/page";

export const dynamic = "force-dynamic";

export default async function ContentPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  return StructuredCollectionPage({
    params: Promise.resolve({ collection: "posts" }),
    searchParams,
  });
}
