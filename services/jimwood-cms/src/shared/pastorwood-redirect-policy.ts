export type PastorWoodRedirectRule = {
  documentId?: string;
  fromPath: unknown;
  toPath: unknown;
  statusCode?: unknown;
  active?: unknown;
  archivedAt?: unknown;
};

export type NormalizedPastorWoodRedirectRule = {
  documentId: string;
  fromPath: string;
  toPath: string;
  statusCode: 301 | 302 | 307 | 308;
  active: boolean;
  archivedAt: string | null;
};

export type PastorWoodRedirectValidation =
  | { ok: true; rule: NormalizedPastorWoodRedirectRule }
  | {
      ok: false;
      code:
        | "invalid-source"
        | "owned-source"
        | "invalid-target"
        | "invalid-status"
        | "self-loop"
        | "duplicate-source"
        | "cycle"
        | "chain";
      message: string;
    };

const protectedInternalPrefixes = [
  "/admin",
  "/api",
  "/archive",
  "/compose",
  "/content",
  "/episodes",
  "/login",
  "/overview",
  "/pipeline",
  "/podcast",
  "/preview",
  "/reading-plan",
  "/research",
  "/sermons",
  "/signals",
  "/sources",
  "/stats",
  "/_next",
];

const ownedPublicRoutes = new Set([
  "/",
  "/about-pastor-wood/",
  "/abiding-in-christ/",
  "/bible-study/",
  "/board-members/",
  "/contact/",
  "/donate/",
  "/donor-dashboard/",
  "/endorsements/",
  "/feed/",
  "/media/",
  "/privacy/",
  "/privacy-terms-conditions/",
  "/radio/",
  "/sitemap.xml",
  "/unsubscribe/",
  "/writings/",
  "/written-resources/",
  "/wp-content/uploads/",
]);

const ownedPublicPrefixes = ["/media/", "/privacy/", "/writings/"];

export function normalizePastorWoodRedirectPath(value: unknown) {
  if (typeof value !== "string") return "";
  let decoded = value.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return "";
  }
  if (
    !decoded.startsWith("/")
    || decoded.startsWith("//")
    || decoded.includes("\\")
    || decoded.includes("?")
    || decoded.includes("#")
    || /[\u0000-\u001f]/.test(decoded)
  ) {
    return "";
  }
  const path = decoded.replace(/\/{2,}/g, "/");
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return "";
  const pathSegments = path.split("/").filter(Boolean);
  const finalSegment = pathSegments[pathSegments.length - 1] || "";
  const hasExtension = /\.[A-Za-z0-9]{1,12}$/.test(finalSegment);
  return path !== "/" && !hasExtension ? `${path.replace(/\/+$/, "")}/` : path;
}

export function pastorWoodRedirectPathKey(value: unknown) {
  return normalizePastorWoodRedirectPath(value).toLowerCase();
}

export function isProtectedPastorWoodRedirectPath(value: unknown) {
  const path = pastorWoodRedirectPathKey(value);
  return Boolean(path && protectedInternalPrefixes.some(
    (prefix) => path === `${prefix}/` || path.startsWith(`${prefix}/`),
  ));
}

export function isOwnedPastorWoodPublicRoute(value: unknown) {
  const path = pastorWoodRedirectPathKey(value);
  return Boolean(path && (
    ownedPublicRoutes.has(path)
    || ownedPublicPrefixes.some((prefix) => path.startsWith(prefix))
  ));
}

export function isSafePastorWoodRedirectTarget(value: unknown) {
  const target = normalizePastorWoodRedirectPath(value);
  return Boolean(target && !isProtectedPastorWoodRedirectPath(target));
}

function normalizedRule(input: PastorWoodRedirectRule): PastorWoodRedirectValidation {
  const fromPath = normalizePastorWoodRedirectPath(input.fromPath);
  if (!fromPath || isProtectedPastorWoodRedirectPath(fromPath)) {
    return {
      ok: false,
      code: "invalid-source",
      message: "Legacy path must be a non-reserved site path beginning with one slash.",
    };
  }
  if (isOwnedPastorWoodPublicRoute(fromPath)) {
    return {
      ok: false,
      code: "owned-source",
      message: "A managed redirect cannot replace an owned PastorWood public route.",
    };
  }
  const toPath = normalizePastorWoodRedirectPath(input.toPath);
  if (!toPath || !isSafePastorWoodRedirectTarget(toPath)) {
    return {
      ok: false,
      code: "invalid-target",
      message: "Redirect destination must be a non-reserved path on this site.",
    };
  }
  const statusCode = input.statusCode === undefined ? 301 : Number(input.statusCode);
  if (![301, 302, 307, 308].includes(statusCode)) {
    return {
      ok: false,
      code: "invalid-status",
      message: "Redirect status must be 301, 302, 307, or 308.",
    };
  }
  if (pastorWoodRedirectPathKey(fromPath) === pastorWoodRedirectPathKey(toPath)) {
    return { ok: false, code: "self-loop", message: "A redirect cannot point to itself." };
  }
  return {
    ok: true,
    rule: {
      documentId: typeof input.documentId === "string" ? input.documentId : "",
      fromPath,
      toPath,
      statusCode: statusCode as NormalizedPastorWoodRedirectRule["statusCode"],
      active: input.active !== false,
      archivedAt: typeof input.archivedAt === "string" && input.archivedAt.trim()
        ? input.archivedAt.trim()
        : null,
    },
  };
}

function graphHasCycle(edges: Map<string, NormalizedPastorWoodRedirectRule>) {
  const complete = new Set<string>();
  for (const start of edges.keys()) {
    if (complete.has(start)) continue;
    const path = new Set<string>();
    let cursor: string | undefined = start;
    while (cursor && edges.has(cursor) && !complete.has(cursor)) {
      if (path.has(cursor)) return true;
      path.add(cursor);
      cursor = pastorWoodRedirectPathKey(edges.get(cursor)?.toPath);
    }
    for (const visited of path) complete.add(visited);
  }
  return false;
}

export function validatePastorWoodRedirectGraph(
  candidate: PastorWoodRedirectRule,
  existingRules: PastorWoodRedirectRule[],
): PastorWoodRedirectValidation {
  const candidateResult = normalizedRule(candidate);
  if (!candidateResult.ok) return candidateResult;
  const candidateRule = candidateResult.rule;
  if (!candidateRule.active || candidateRule.archivedAt) return candidateResult;

  const rules: NormalizedPastorWoodRedirectRule[] = [];
  for (const existing of existingRules) {
    const documentId = typeof existing.documentId === "string" ? existing.documentId : "";
    if (candidateRule.documentId && documentId === candidateRule.documentId) continue;
    if (existing.active === false || (typeof existing.archivedAt === "string" && existing.archivedAt.trim())) continue;
    const result = normalizedRule(existing);
    if (!result.ok) return result;
    rules.push(result.rule);
  }
  rules.push(candidateRule);

  const edges = new Map<string, NormalizedPastorWoodRedirectRule>();
  for (const rule of rules) {
    const source = pastorWoodRedirectPathKey(rule.fromPath);
    if (edges.has(source)) {
      return {
        ok: false,
        code: "duplicate-source",
        message: "Another active redirect already owns this legacy path, including case and trailing-slash variants.",
      };
    }
    edges.set(source, rule);
  }

  if (graphHasCycle(edges)) {
    return { ok: false, code: "cycle", message: "Redirect cycles are not allowed." };
  }
  for (const rule of edges.values()) {
    if (edges.has(pastorWoodRedirectPathKey(rule.toPath))) {
      return {
        ok: false,
        code: "chain",
        message: "Redirect chains are not allowed; every destination must be a final public path.",
      };
    }
  }

  return candidateResult;
}

export const PASTORWOOD_OWNED_PUBLIC_ROUTES = [...ownedPublicRoutes];
export const PASTORWOOD_PROTECTED_REDIRECT_PREFIXES = [...protectedInternalPrefixes];
