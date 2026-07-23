"use client";

import { ConsoleRouteError } from "@/components/console-route-error";

export default function PreviewError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="public-shell" id="main-content" tabIndex={-1}>
      <ConsoleRouteError
        area="draft-preview"
        backHref="/content"
        backLabel="Back to content management"
        error={error}
        message="The unpublished preview could not be loaded. No draft content or system details are shown here."
        reset={reset}
        title="The draft preview did not load"
      />
    </main>
  );
}
