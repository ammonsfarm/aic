export function contentSecurityPolicy(nodeEnv = process.env.NODE_ENV) {
  const scriptSources = ["'self'", "'unsafe-inline'", "https:"];
  if (nodeEnv !== "production") {
    scriptSources.push("'unsafe-eval'");
  }

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data: https:",
    "connect-src 'self' https: wss:",
    "frame-src 'self' https:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https:",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function applicationSecurityHeaders(nodeEnv = process.env.NODE_ENV) {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(nodeEnv) },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ];
}
