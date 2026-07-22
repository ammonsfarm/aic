import redirectManifest from "@/data/legacy-redirects.json";

export type LegacyRedirect = {
  fromPath: string;
  toPath: string;
  statusCode: 301 | 302 | 307 | 308;
  active: boolean;
  notes?: string;
  sourceUrl?: string;
};

const reservedTargets = [
  "/admin",
  "/api",
  "/archive",
  "/compose",
  "/content",
  "/login",
  "/overview",
  "/pipeline",
  "/preview",
  "/research",
  "/signals",
  "/sources",
  "/stats",
  "/_next",
];

function isReservedPath(value: string) {
  const path = normalizePath(value);
  return Boolean(path && reservedTargets.some((prefix) => path === `${prefix}/` || path.startsWith(`${prefix}/`)));
}

function normalizePath(value: string) {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "";
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\") || /[\u0000-\u001f]/.test(decoded)) {
    return "";
  }
  const path = decoded.replace(/\/{2,}/g, "/");
  const finalSegment = path.split("/").filter(Boolean).at(-1) || "";
  const hasExtension = /\.[A-Za-z0-9]{1,12}$/.test(finalSegment);
  return path !== "/" && !hasExtension ? `${path.replace(/\/+$/, "")}/` : path;
}

export function isSafeLegacyRedirectTarget(value: string) {
  const target = normalizePath(value);
  if (!target || target.startsWith("//")) return false;
  return !reservedTargets.some((prefix) => target === prefix || target.startsWith(`${prefix}/`));
}

const redirectMap = new Map<string, LegacyRedirect>();
for (const raw of redirectManifest as LegacyRedirect[]) {
  const fromPath = normalizePath(raw.fromPath);
  const toPath = normalizePath(raw.toPath);
  if (!raw.active || !fromPath || !toPath || isReservedPath(fromPath) || !isSafeLegacyRedirectTarget(toPath)) continue;
  if (![301, 302, 307, 308].includes(Number(raw.statusCode))) continue;
  redirectMap.set(fromPath.toLowerCase(), { ...raw, fromPath, toPath });
}

export function resolveLegacyRedirect(pathname: string): LegacyRedirect | null {
  const source = normalizePath(pathname);
  if (!source || isReservedPath(source)) return null;
  const redirect = redirectMap.get(source.toLowerCase());
  if (!redirect) return null;
  if (source.replace(/\/+$/, "").toLowerCase() === redirect.toPath.replace(/\/+$/, "").toLowerCase()) {
    return null;
  }
  return redirect;
}

export function legacyRedirectCount() {
  return redirectMap.size;
}

export { normalizePath as normalizeLegacyRequestPath };
export { isReservedPath as isReservedLegacyRedirectSource };
