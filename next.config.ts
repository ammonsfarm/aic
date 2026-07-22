import type { NextConfig } from "next";

import { applicationSecurityHeaders } from "./lib/security-headers";
import { SERVER_ACTION_BODY_SIZE_LIMIT } from "./lib/structured-editor-upload-limits";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: SERVER_ACTION_BODY_SIZE_LIMIT,
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
