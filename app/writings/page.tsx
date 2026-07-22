import { permanentRedirect } from "next/navigation";

export default function LegacyWritingsIndex() {
  permanentRedirect("/written-resources/");
}
