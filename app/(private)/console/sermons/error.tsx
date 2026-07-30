"use client";

import { ConsoleRouteError } from "@/components/console-route-error";

export default function SermonsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ConsoleRouteError
        area="sermon-index"
        backHref="/console/episodes"
        backLabel="Back to archive search"
        error={error}
        message="The protected sermon index could not be loaded. No corpus or system details are shown here."
        reset={reset}
        title="The sermon index did not load"
    />
  );
}
