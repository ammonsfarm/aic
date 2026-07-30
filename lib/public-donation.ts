const LEGACY_DONATION_URL = "https://www.pastorwood.org/?givewp-route=donation-form-view&form-id=14759";
const LEGACY_DONOR_DASHBOARD_URL = "https://www.pastorwood.org/donor-dashboard/";

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

export function safeExternalDonationUrl(
  value: string | undefined | null,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash) return null;
    // pastorwood.org is this application after cutover. A self-link cannot be
    // treated as an external payment processor, even in previews or tests.
    if (PASTORWOOD_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    return safeHttpsProviderUrl(candidate, configuredHosts(environment.PASTORWOOD_DONATION_ALLOWED_HOSTS));
  } catch {
    return null;
  }
}

export function safeExternalDonorDashboardUrl(
  value: string | undefined | null,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash) return null;
    if (PASTORWOOD_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    return safeHttpsProviderUrl(candidate, configuredHosts(environment.PASTORWOOD_DONOR_DASHBOARD_ALLOWED_HOSTS));
  } catch {
    return null;
  }
}

export function getPublicDonationUrl(
  cmsValue?: string | null,
  environment: NodeJS.ProcessEnv = process.env,
) {
  return (
    safeExternalDonationUrl(cmsValue, environment) ||
    safeExternalDonationUrl(environment.PASTORWOOD_DONATION_URL, environment)
  );
}

export function getPublicDonorDashboardUrl(
  cmsValue?: string | null,
  environment: NodeJS.ProcessEnv = process.env,
) {
  return (
    safeExternalDonorDashboardUrl(cmsValue, environment) ||
    safeExternalDonorDashboardUrl(environment.PASTORWOOD_DONOR_DASHBOARD_URL, environment)
  );
}

export { LEGACY_DONATION_URL, LEGACY_DONOR_DASHBOARD_URL };
