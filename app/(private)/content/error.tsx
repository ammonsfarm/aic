"use client";

import { ConsoleRouteError } from "@/components/console-route-error";

export default function ContentConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ConsoleRouteError
      area="content-console"
      backHref="/content"
      backLabel="Back to content overview"
      error={error}
      message="This protected workspace could not be loaded. No account, draft, or system details are shown here."
      reset={reset}
      title="The content workspace did not load"
    />
  );
}
