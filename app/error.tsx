"use client";

import { ConsoleRouteError } from "@/components/console-route-error";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="public-shell">
      <ConsoleRouteError
        area="application"
        backHref="/"
        backLabel="Back to the public site"
        error={error}
        message="This page could not be loaded. No account, content, or system details are shown here."
        reset={reset}
        title="This page is temporarily unavailable"
      />
    </main>
  );
}
