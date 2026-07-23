const DEFAULT_DONATION_URL = "https://www.pastorwood.org/?givewp-route=donation-form-view&form-id=14759";
const DEFAULT_DONOR_DASHBOARD_URL = "https://www.pastorwood.org/donor-dashboard/";

const PASTORWOOD_HOSTS = new Set(["pastorwood.org", "www.pastorwood.org"]);

function configuredHosts(value: string | undefined) {
  return new Set(
    (value || "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter((host) => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)),
  );
}

function safeHttpsProviderUrl(value: string | undefined | null, allowlist: Set<string>) {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.hash ||
      !allowlist.has(hostname)
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function isCanonicalGiveWpRoute(parsed: URL) {
  if (!PASTORWOOD_HOSTS.has(parsed.hostname.toLowerCase()) || parsed.pathname !== "/") return false;
  if (parsed.searchParams.size !== 2) return false;
  return (
    parsed.searchParams.get("givewp-route") === "donation-form-view" &&
    parsed.searchParams.get("form-id") === "14759"
  );
}

export function safeExternalDonationUrl(value: string | undefined | null) {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash) return null;
    if (PASTORWOOD_HOSTS.has(parsed.hostname.toLowerCase())) {
      return isCanonicalGiveWpRoute(parsed) ? DEFAULT_DONATION_URL : null;
    }
    return safeHttpsProviderUrl(candidate, configuredHosts(process.env.PASTORWOOD_DONATION_ALLOWED_HOSTS));
  } catch {
    return null;
  }
}

export function safeExternalDonorDashboardUrl(value: string | undefined | null) {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash) return null;
    if (PASTORWOOD_HOSTS.has(parsed.hostname.toLowerCase())) {
      const canonicalPath = parsed.pathname === "/donor-dashboard" || parsed.pathname === "/donor-dashboard/";
      return canonicalPath && !parsed.search ? DEFAULT_DONOR_DASHBOARD_URL : null;
    }
    return safeHttpsProviderUrl(candidate, configuredHosts(process.env.PASTORWOOD_DONOR_DASHBOARD_ALLOWED_HOSTS));
  } catch {
    return null;
  }
}

export function getPublicDonationUrl(cmsValue?: string | null) {
  return (
    safeExternalDonationUrl(cmsValue) ||
    safeExternalDonationUrl(process.env.PASTORWOOD_DONATION_URL) ||
    DEFAULT_DONATION_URL
  );
}

export function getPublicDonorDashboardUrl(cmsValue?: string | null) {
  return (
    safeExternalDonorDashboardUrl(cmsValue) ||
    safeExternalDonorDashboardUrl(process.env.PASTORWOOD_DONOR_DASHBOARD_URL) ||
    DEFAULT_DONOR_DASHBOARD_URL
  );
}

export { DEFAULT_DONATION_URL, DEFAULT_DONOR_DASHBOARD_URL };
