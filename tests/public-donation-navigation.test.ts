import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ settings: vi.fn() }));

vi.mock("@/lib/strapi-site-settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/strapi-site-settings")>();
  return { ...original, getStrapiSiteSettings: mocks.settings };
});

import { PastorWoodContentPage, PastorWoodShell } from "@/components/pastor-wood-site";
import { LEGACY_DONATION_URL, LEGACY_DONOR_DASHBOARD_URL } from "@/lib/public-donation";
import type { StrapiSiteSettings } from "@/lib/strapi-site-settings";

function settings(overrides: Partial<StrapiSiteSettings> = {}): StrapiSiteSettings {
  return {
    siteName: "Abiding in Christ",
    topNavigation: [],
    footerNavigation: [],
    utilityNavigation: [],
    footerText: "A ministry of Jim Wood.",
    copyrightText: "",
    showDonateButton: true,
    donateButtonLabel: "Donate",
    donateButtonUrl: LEGACY_DONATION_URL,
    donorDashboardUrl: LEGACY_DONOR_DASHBOARD_URL,
    headerLogo: null,
    subscriptionPublishedEnabled: false,
    subscriptionEnabled: false,
    ...overrides,
  };
}

function renderShell(siteSettings: StrapiSiteSettings) {
  const Shell = PastorWoodShell as React.ComponentType<{
    children?: React.ReactNode;
    siteSettings?: StrapiSiteSettings | null;
  }>;
  return renderToStaticMarkup(
    React.createElement(Shell, { siteSettings }, React.createElement("p", null, "Page content")),
  );
}

beforeEach(() => {
  mocks.settings.mockReset();
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public donation navigation and provider precedence", () => {
  it("does not render an empty CTA when a published donation destination fails closed", () => {
    const markup = renderShell(settings());

    expect(markup).not.toContain("pw-nav__cta");
    expect(markup).not.toContain('href=""');
  });

  it("uses the allowlisted operations provider when the published CMS destination is stale", async () => {
    vi.stubEnv("PASTORWOOD_DONATION_ALLOWED_HOSTS", "give.example.org");
    vi.stubEnv("PASTORWOOD_DONATION_URL", "https://give.example.org/forms/14759");
    vi.stubEnv("PASTORWOOD_DONOR_DASHBOARD_ALLOWED_HOSTS", "account.example.org");
    vi.stubEnv("PASTORWOOD_DONOR_DASHBOARD_URL", "https://account.example.org/portal");
    const siteSettings = settings();
    mocks.settings.mockResolvedValue(siteSettings);

    expect(renderShell(siteSettings)).toContain('href="https://give.example.org/forms/14759"');

    const donateMarkup = renderToStaticMarkup(await PastorWoodContentPage({ page: "donate" }));
    const dashboardMarkup = renderToStaticMarkup(await PastorWoodContentPage({ page: "donorDashboard" }));
    expect(donateMarkup).toContain('href="https://give.example.org/forms/14759"');
    expect(dashboardMarkup).toContain('href="https://account.example.org/portal"');
  });

  it("keeps the published donation-button visibility switch authoritative", () => {
    vi.stubEnv("PASTORWOOD_DONATION_ALLOWED_HOSTS", "give.example.org");
    vi.stubEnv("PASTORWOOD_DONATION_URL", "https://give.example.org/forms/14759");

    expect(renderShell(settings({ showDonateButton: false }))).not.toContain("pw-nav__cta");
  });
});
