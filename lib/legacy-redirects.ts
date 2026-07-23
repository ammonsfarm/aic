import redirectManifest from "@/data/legacy-redirects.json";
import { pastorWoodPublicCmsCutoverEnabled } from "@/lib/pastorwood-public-cms-cutover";
import { getProjectedContentByIdentity } from "@/lib/public-content-projection";
import { fetchStrapiJsonResult } from "@/lib/strapi-request";
import { STRAPI_STRUCTURED_CACHE_TAG, strapiStructuredCacheTag } from "@/lib/strapi-cache-tags";

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
  "/privacy",
  "/research",
  "/signals",
  "/sources",
  "/stats",
  "/_next",
];

// /privacy is owned by the existing Sermon Search GPT policy page. The
// PastorWood policy is imported at /privacy-terms-conditions, and no generated
// or content-managed legacy redirect may shadow the GPT route.
const protectedCurrentRouteSources = ["/privacy"];

function isReservedPath(value: string) {
  const path = normalizePath(value);
  const lowerPath = path.toLowerCase();
  return Boolean(path && (
    reservedTargets.some((prefix) => lowerPath === `${prefix}/` || lowerPath.startsWith(`${prefix}/`))
    || protectedCurrentRouteSources.some((source) => lowerPath === `${source}/` || lowerPath.startsWith(`${source}/`))
  ));
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
  const lowerTarget = target.toLowerCase();
  return !reservedTargets.some((prefix) => lowerTarget === prefix || lowerTarget.startsWith(`${prefix}/`));
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

function strapiRedirectOrigin() {
  return (process.env.STRAPI_PUBLIC_URL?.trim() || process.env.STRAPI_URL?.trim() || "").replace(/\/+$/, "");
}

function managedRedirect(value: unknown, source: string): LegacyRedirect | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const attributes = raw.attributes && typeof raw.attributes === "object"
    ? raw.attributes as Record<string, unknown>
    : {};
  const entry = { ...attributes, ...raw };
  if (entry.active !== true || (typeof entry.archivedAt === "string" && entry.archivedAt.trim())) return null;
  const fromPath = normalizePath(typeof entry.fromPath === "string" ? entry.fromPath : "");
  const toPath = normalizePath(typeof entry.toPath === "string" ? entry.toPath : "");
  const statusCode = Number(entry.statusCode);
  if (
    !fromPath
    || fromPath.toLowerCase() !== source.toLowerCase()
    || isReservedPath(fromPath)
    || !toPath
    || !isSafeLegacyRedirectTarget(toPath)
    || ![301, 302, 307, 308].includes(statusCode)
    || fromPath.replace(/\/+$/, "").toLowerCase() === toPath.replace(/\/+$/, "").toLowerCase()
  ) {
    return null;
  }
  return {
    fromPath,
    toPath,
    statusCode: statusCode as LegacyRedirect["statusCode"],
    active: true,
    notes: typeof entry.notes === "string" ? entry.notes : undefined,
    sourceUrl: typeof entry.sourceUrl === "string" ? entry.sourceUrl : undefined,
  };
}

/**
 * Resolve the content-manager redirect first. A successful empty/inactive result
 * is authoritative; the generated manifest is used only when Strapi is absent
 * or unavailable, so an editor can disable or delete a redirect immediately.
 */
export async function resolvePublicLegacyRedirect(pathname: string): Promise<LegacyRedirect | null> {
  const source = normalizePath(pathname);
  if (!source || isReservedPath(source)) return null;
  const fallback = resolveLegacyRedirect(source);
  if (!pastorWoodPublicCmsCutoverEnabled()) return fallback;
  const projectedOrBootstrap = async () => {
    try {
      const projection = await getProjectedContentByIdentity<Record<string, unknown>>(
        "redirect",
        "path",
        source.toLowerCase(),
      );
      if (projection.status === "found") return managedRedirect(projection.item, source);
      return projection.status === "not-found" ? null : fallback;
    } catch (error) {
      console.error("Managed legacy redirect projection lookup failed; using the bootstrap manifest.", error);
      return fallback;
    }
  };
  const origin = strapiRedirectOrigin();
  if (!origin) return projectedOrBootstrap();

  const url = new URL("/api/redirects", origin);
  url.searchParams.set("pagination[pageSize]", "2");
  url.searchParams.set("filters[fromPath][$eq]", source);
  const token = process.env.STRAPI_READ_TOKEN?.trim() || process.env.STRAPI_API_TOKEN?.trim() || "";
  try {
    const result = await fetchStrapiJsonResult<{ data?: unknown[] }>(
      url,
      {
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        next: {
          revalidate: 300,
          tags: [STRAPI_STRUCTURED_CACHE_TAG, strapiStructuredCacheTag("redirects")],
        },
      },
      { label: "Managed legacy redirect lookup", publicRequest: true },
    );
    if (result.status === "unavailable") return projectedOrBootstrap();
    const payload = result.data;
    if (!Array.isArray(payload.data)) return projectedOrBootstrap();
    if (payload.data.length !== 1) return null;
    return managedRedirect(payload.data[0], source);
  } catch (error) {
    console.error("Managed legacy redirect lookup failed; using the public continuity projection.", error);
    return projectedOrBootstrap();
  }
}

export function legacyRedirectCount() {
  return redirectMap.size;
}

export { normalizePath as normalizeLegacyRequestPath };
export { isReservedPath as isReservedLegacyRedirectSource };
