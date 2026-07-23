import { ConsoleRouteLoading } from "@/components/console-route-loading";

export default function ReadingPlanLoading() {
  return (
    <main className="public-shell" id="main-content" tabIndex={-1}>
      <ConsoleRouteLoading
        eyebrow="Reading plan"
        message="Loading authorized Scripture planning and archive research tools."
        title="Loading reading-plan builder"
      />
    </main>
  );
}
