const DEFAULT_DONATION_URL = "https://www.pastorwood.org/donations/givewp-donation-form/";

export function safeExternalDonationUrl(value: string | undefined | null) {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
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
