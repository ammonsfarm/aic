import type { NextConfig } from "next";

import { applicationSecurityHeaders } from "./lib/security-headers";
import { NEXT_PHASE_ENV_KEY } from "./lib/database-runtime-boundary";
import { SERVER_ACTION_BODY_SIZE_LIMIT } from "./lib/structured-editor-upload-limits";

export const nextConfig: NextConfig = {
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

export default function configureNext(phase: string): NextConfig {
  // The phase argument is the authoritative signal supplied by Next itself.
  // Propagate it to server modules and build workers so database access can be
  // rejected before production credentials or a PostgreSQL client are touched.
  Reflect.set(process.env, NEXT_PHASE_ENV_KEY, phase);
  return nextConfig;
}
