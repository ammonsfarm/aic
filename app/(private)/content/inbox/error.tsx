"use client";

import { ConsoleRouteError } from "@/components/console-route-error";

export default function ContactInboxError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ConsoleRouteError
      area="contact inbox"
      backHref="/content"
      backLabel="Back to content overview"
      error={error}
      message="Stored correspondence could not be loaded. No sender details are shown on this error screen."
      reset={reset}
      title="The contact inbox did not load"
    />
  );
}
