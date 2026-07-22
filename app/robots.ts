import type { MetadataRoute } from "next";

import { isPublicIndexingEnabled, publicSiteOrigin } from "@/lib/public-seo";

export default function robots(): MetadataRoute.Robots {
  if (!isPublicIndexingEnabled()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/admin/", "/api/", "/archive/", "/compose/", "/content/", "/login/", "/overview/", "/pipeline/", "/preview/", "/signals/", "/sources/", "/stats/"],
    }],
    sitemap: `${publicSiteOrigin()}/sitemap.xml`,
  };
}
