import { redirect } from "next/navigation";

import {
  consolePathWithSearchParams,
  type ConsoleRedirectSearchParams,
} from "@/lib/console-route-redirects";
import { requireResearchConsoleUser } from "@/lib/console-access";

export default async function LegacyResearchPage({
  searchParams,
}: {
  searchParams: Promise<ConsoleRedirectSearchParams>;
}) {
  await requireResearchConsoleUser();
  redirect(consolePathWithSearchParams("/console/research", await searchParams));
}
