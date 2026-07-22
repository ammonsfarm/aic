import type { MetadataRoute } from "next";

import { isPublicIndexingEnabled, publicSiteOrigin } from "@/lib/public-seo";
import { PRIVATE_TOP_LEVEL_SEGMENTS } from "@/lib/route-access";

export default function robots(): MetadataRoute.Robots {
  if (!isPublicIndexingEnabled()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/login/",
        ...[...PRIVATE_TOP_LEVEL_SEGMENTS].sort().map((segment) => `/${segment}/`),
      ],
    }],
    sitemap: `${publicSiteOrigin()}/sitemap.xml`,
  };
}
