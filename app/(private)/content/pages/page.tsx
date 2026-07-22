import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LegacyContentPagesRoute() {
  redirect("/content/site-pages");
}
