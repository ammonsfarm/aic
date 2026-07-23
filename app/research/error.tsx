"use client";

import { ConsoleRouteError } from "@/components/console-route-error";

export default function ResearchError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="public-shell" id="main-content" tabIndex={-1}>
      <ConsoleRouteError
        area="research-console"
        backHref="/podcast"
        backLabel="Back to podcast statistics"
        error={error}
        message="The protected research workspace could not be loaded. No question history or system details are shown here."
        reset={reset}
        title="The research workspace did not load"
      />
    </main>
  );
}
