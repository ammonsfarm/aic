import { ConsoleRouteLoading } from "@/components/console-route-loading";

export default function EpisodesLoading() {
  return (
    <ConsoleRouteLoading
        eyebrow="Internal archive"
        message="Loading authorized episode records, transcript context, and research tools."
        title="Loading episode archive"
    />
  );
}
