import { ConsoleRouteLoading } from "@/components/console-route-loading";

export default function PreviewLoading() {
  return (
    <main className="public-shell" id="main-content" tabIndex={-1}>
      <ConsoleRouteLoading
        eyebrow="Draft preview"
        message="Loading the authorized unpublished content preview."
        title="Loading draft preview"
      />
    </main>
  );
}
