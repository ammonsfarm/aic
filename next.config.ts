import type { NextConfig } from "next";

import { applicationSecurityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: applicationSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
