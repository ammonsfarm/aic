"use client";

import { ConsoleRouteError } from "@/components/console-route-error";

export default function SermonsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="public-shell" id="main-content" tabIndex={-1}>
      <ConsoleRouteError
        area="sermon-index"
        backHref="/archive"
        backLabel="Back to archive search"
        error={error}
        message="The protected sermon index could not be loaded. No corpus or system details are shown here."
        reset={reset}
        title="The sermon index did not load"
      />
    </main>
  );
}
