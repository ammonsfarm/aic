import { redirect } from "next/navigation";

import {
  consolePathWithSearchParams,
  type ConsoleRedirectSearchParams,
} from "@/lib/console-route-redirects";
import { requireInternalReadConsoleUser } from "@/lib/console-access";

export default async function LegacyEpisodesPage({
  searchParams,
}: {
  searchParams: Promise<ConsoleRedirectSearchParams>;
}) {
  await requireInternalReadConsoleUser();
  redirect(consolePathWithSearchParams("/console/episodes", await searchParams));
}
