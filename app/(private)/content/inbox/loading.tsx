import { ConsoleRouteLoading } from "@/components/console-route-loading";

export default function ContactInboxLoading() {
  return (
    <ConsoleRouteLoading
      eyebrow="Contact inbox"
      title="Loading stored messages"
      message="Loading the latest contact-message and notification state."
    />
  );
}
