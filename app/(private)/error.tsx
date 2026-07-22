"use client";

import { ConsoleRouteError } from "@/components/console-route-error";

export default function PrivateConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ConsoleRouteError
      area="console"
      backHref="/podcast"
      backLabel="Back to podcast statistics"
      error={error}
      message="This protected page could not be loaded. No account, content, or system details are shown here."
      reset={reset}
      title="The console page did not load"
    />
  );
}
