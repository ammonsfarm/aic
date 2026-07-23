"use client";

import { ConsoleRouteError } from "@/components/console-route-error";

export default function ReadingPlanError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="public-shell" id="main-content" tabIndex={-1}>
      <ConsoleRouteError
        area="reading-plan"
        backHref="/podcast"
        backLabel="Back to podcast statistics"
        error={error}
        message="The protected reading-plan builder could not be loaded. No account or research details are shown here."
        reset={reset}
        title="The reading-plan builder did not load"
      />
    </main>
  );
}
