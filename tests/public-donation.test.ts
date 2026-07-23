import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_DONATION_URL,
  DEFAULT_DONOR_DASHBOARD_URL,
  getPublicDonationUrl,
  getPublicDonorDashboardUrl,
  safeExternalDonationUrl,
  safeExternalDonorDashboardUrl,
} from "@/lib/public-donation";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public donation destinations", () => {
  it("uses only the verified canonical GiveWP query route on PastorWood hosts", () => {
    expect(DEFAULT_DONATION_URL).toBe("https://www.pastorwood.org/?givewp-route=donation-form-view&form-id=14759");
    expect(safeExternalDonationUrl(DEFAULT_DONATION_URL)).toBe(DEFAULT_DONATION_URL);
    expect(safeExternalDonationUrl("https://pastorwood.org/?form-id=14759&givewp-route=donation-form-view")).toBe(DEFAULT_DONATION_URL);
    for (const value of [
      "https://www.pastorwood.org/donations/givewp-donation-form/",
      "https://www.pastorwood.org/donate/",
      "https://www.pastorwood.org/?givewp-route=donation-form-view&form-id=999",
      "https://www.pastorwood.org/?givewp-route=donation-form-view&form-id=14759&next=evil",
      "http://www.pastorwood.org/?givewp-route=donation-form-view&form-id=14759",
      "https://user:pass@www.pastorwood.org/?givewp-route=donation-form-view&form-id=14759",
      "https://www.pastorwood.org:8443/?givewp-route=donation-form-view&form-id=14759",
    ]) {
      expect(safeExternalDonationUrl(value)).toBeNull();
    }
  });

  it("accepts other HTTPS giving hosts only through the donation-specific allowlist", () => {
    vi.stubEnv("PASTORWOOD_DONATION_ALLOWED_HOSTS", "give.example.org");
    expect(safeExternalDonationUrl("https://give.example.org/forms/14759?campaign=radio"))
      .toBe("https://give.example.org/forms/14759?campaign=radio");
    expect(safeExternalDonationUrl("https://dashboard.example.org/forms/14759")).toBeNull();
    expect(safeExternalDonationUrl("https://give.example.org.evil.test/forms/14759")).toBeNull();
  });

  it("keeps donor dashboard configuration and allowlisting separate", () => {
    vi.stubEnv("PASTORWOOD_DONATION_ALLOWED_HOSTS", "give.example.org");
    vi.stubEnv("PASTORWOOD_DONOR_DASHBOARD_ALLOWED_HOSTS", "account.example.org");
    expect(safeExternalDonorDashboardUrl(DEFAULT_DONOR_DASHBOARD_URL)).toBe(DEFAULT_DONOR_DASHBOARD_URL);
    expect(safeExternalDonorDashboardUrl("https://www.pastorwood.org/donor-dashboard?redirect=evil")).toBeNull();
    expect(safeExternalDonorDashboardUrl("https://account.example.org/portal"))
      .toBe("https://account.example.org/portal");
    expect(safeExternalDonorDashboardUrl("https://give.example.org/portal")).toBeNull();
  });

  it("falls back safely when configured values are invalid", () => {
    vi.stubEnv("PASTORWOOD_DONATION_URL", "https://evil.example/pay");
    vi.stubEnv("PASTORWOOD_DONOR_DASHBOARD_URL", "https://evil.example/account");
    expect(getPublicDonationUrl("https://evil.example/pay")).toBe(DEFAULT_DONATION_URL);
    expect(getPublicDonorDashboardUrl("https://evil.example/account")).toBe(DEFAULT_DONOR_DASHBOARD_URL);
  });

  it("fails closed on canonical self-links in production even when the public URL is absent or wrong", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const publicUrl of ["", "not-a-url", "https://preview.example.test"]) {
      vi.stubEnv("PASTORWOOD_PUBLIC_URL", publicUrl);
      expect(safeExternalDonationUrl(DEFAULT_DONATION_URL)).toBeNull();
      expect(safeExternalDonorDashboardUrl(DEFAULT_DONOR_DASHBOARD_URL)).toBeNull();
      expect(getPublicDonationUrl()).toBeNull();
      expect(getPublicDonorDashboardUrl()).toBeNull();
    }
  });

  it("still accepts an explicitly allowlisted external provider in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PASTORWOOD_DONATION_ALLOWED_HOSTS", "give.example.org");
    vi.stubEnv("PASTORWOOD_DONATION_URL", "https://give.example.org/forms/14759");
    expect(getPublicDonationUrl()).toBe("https://give.example.org/forms/14759");
  });
});
