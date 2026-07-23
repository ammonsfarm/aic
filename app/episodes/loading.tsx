import { ConsoleRouteLoading } from "@/components/console-route-loading";

export default function EpisodesLoading() {
  return (
    <main className="public-shell" id="main-content" tabIndex={-1}>
      <ConsoleRouteLoading
        eyebrow="Internal archive"
        message="Loading authorized episode records, transcript context, and research tools."
        title="Loading episode archive"
      />
    </main>
  );
}
