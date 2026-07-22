import StructuredNewEntryPage from "../../structured/[collection]/new/page";

export const dynamic = "force-dynamic";

export default function FriendlyStructuredNewPage() {
  return StructuredNewEntryPage({
    params: Promise.resolve({ collection: "people" }),
  });
}
