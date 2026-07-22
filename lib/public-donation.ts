const DEFAULT_DONATION_URL = "https://www.pastorwood.org/donations/givewp-donation-form/";

export function safeExternalDonationUrl(value: string | undefined | null) {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    const configuredHosts = (process.env.PASTORWOOD_DONATION_ALLOWED_HOSTS || "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    const canonicalHost = ["pastorwood.org", "www.pastorwood.org"].includes(parsed.hostname.toLowerCase());
    const explicitlyAllowed = configuredHosts.includes(parsed.hostname.toLowerCase());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || (!canonicalHost && !explicitlyAllowed)) return null;
    if (canonicalHost && !parsed.pathname.startsWith("/donations/")) return null;
    return parsed.toString();
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

export { DEFAULT_DONATION_URL };
