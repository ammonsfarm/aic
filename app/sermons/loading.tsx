import { ConsoleRouteLoading } from "@/components/console-route-loading";

export default function SermonsLoading() {
  return (
    <main className="public-shell" id="main-content" tabIndex={-1}>
      <ConsoleRouteLoading
        eyebrow="Sermon index"
        message="Loading authorized Scripture and episode mappings."
        title="Loading sermon index"
      />
    </main>
  );
}
