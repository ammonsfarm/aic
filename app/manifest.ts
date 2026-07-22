import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Abiding in Christ with Jim Wood",
    short_name: "Abiding in Christ",
    description: "Bible teaching, radio broadcasts, and devotionals from Pastor Jim Wood.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f0df",
    theme_color: "#183528",
    icons: [{ src: "/images/pastorwood/deep-forest-logo-transparent.png", sizes: "any", type: "image/png" }],
  };
}
