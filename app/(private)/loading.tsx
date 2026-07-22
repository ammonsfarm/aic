import { ConsoleRouteLoading } from "@/components/console-route-loading";

export default function PrivateConsoleLoading() {
  return (
    <ConsoleRouteLoading
      eyebrow="Protected console"
      message="Loading the latest authorized console view."
      title="Loading console"
    />
  );
}
