"use client";

import { ConsoleRouteError } from "@/components/console-route-error";

export default function PodcastError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="public-shell" id="main-content" tabIndex={-1}>
      <ConsoleRouteError
        area="podcast-reports"
        backHref="/"
        backLabel="Back to the public site"
        error={error}
        message="Podcast reporting could not be loaded. No audience, account, or system details are shown here."
        reset={reset}
        title="Podcast statistics did not load"
      />
    </main>
  );
}
