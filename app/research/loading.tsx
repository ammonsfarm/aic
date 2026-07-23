import { ConsoleRouteLoading } from "@/components/console-route-loading";

export default function ResearchLoading() {
  return (
    <main className="public-shell" id="main-content" tabIndex={-1}>
      <ConsoleRouteLoading
        eyebrow="Research console"
        message="Loading authorized archive research tools and source history."
        title="Loading research workspace"
      />
    </main>
  );
}
