import StructuredNewEntryPage from "../../structured/[collection]/new/page";

export const dynamic = "force-dynamic";

export default function NewPostPage() {
  return StructuredNewEntryPage({
    params: Promise.resolve({ collection: "posts" }),
  });
}
