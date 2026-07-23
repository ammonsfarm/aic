import { ConsoleRouteLoading } from "@/components/console-route-loading";

export default function PodcastLoading() {
  return (
    <main className="public-shell" id="main-content" tabIndex={-1}>
      <ConsoleRouteLoading
        eyebrow="Podcast reports"
        message="Loading authorized download, episode, and audience statistics."
        title="Loading podcast statistics"
      />
    </main>
  );
}
