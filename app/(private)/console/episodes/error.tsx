"use client";

import { ConsoleRouteError } from "@/components/console-route-error";

export default function EpisodesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ConsoleRouteError
        area="episode-archive"
        backHref="/console/episodes"
        backLabel="Back to archive search"
        error={error}
        message="The protected episode record could not be loaded. No transcript or system details are shown here."
        reset={reset}
        title="The episode archive did not load"
    />
  );
}
