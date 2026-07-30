import { afterEach, describe, expect, it } from "vitest";

import {
  buildProviderReadiness,
  summarizePublicProviderEvidence,
  type PublicProviderEvidence,
} from "@/lib/provider-readiness";
import {
  disablePastorWoodPublicCmsCutoverForTests,
  enablePastorWoodPublicCmsCutoverForTests,
} from "@/lib/pastorwood-public-cms-cutover";

const emptyPublicEvidence: PublicProviderEvidence = {
  settingsAvailable: false,
  donationValuePresent: false,
  donationConfigured: false,
  donorDashboardValuePresent: false,
  donorDashboardConfigured: false,
  subscriptionsPublishedEnabled: false,
};

function podtracEvidence({
  freshness = "current",
  auth = "ok",
}: {
  freshness?: "current" | "stale" | "missing";
  auth?: "ok" | "auth-error" | "unknown";
} = {}) {
  return {
    freshness: {
      ingest: {
        asOfDate: "2026-07-30",
        lastSuccessfulCheckDate: "2026-07-30",
        lagDays: 0,
        slaDays: 1,
        state: "current" as const,
      },
      podtrac: {
        asOfDate: "2026-07-30",
        dataCurrentThrough: freshness === "missing" ? null : freshness === "stale" ? "2026-07-13" : "2026-07-29",
        lagDays: freshness === "missing" ? null : freshness === "stale" ? 17 : 1,
        slaDays: 2,
        state: freshness,
      },
    },
    podtracAuth: {
      state: auth,
      checkedAt: "2026-07-14T08:00:00Z",
      message: "SENTINEL_OPERATION_MESSAGE_MUST_NOT_RENDER",
    },
  };
}

function baseEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    PASTORWOOD_LAUNCH_STAGE: "development",
    PASTORWOOD_PUBLIC_URL: "https://aic.ammonsfarm.org",
    PASTORWOOD_ALLOW_INDEXING: "false",
    PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED: "false",
    PASTORWOOD_SUBSCRIPTIONS_ENABLED: "false",
    CONTACT_EMAIL_DELIVERY_ENABLED: "false",
    ...overrides,
  };
}

function readinessItem(items: ReturnType<typeof buildProviderReadiness>, id: string) {
  const found = items.find((entry) => entry.id === id);
  expect(found, `Missing readiness item ${id}`).toBeDefined();
  return found!;
}

afterEach(() => {
  if (process.env.NODE_ENV === "test") {
    disablePastorWoodPublicCmsCutoverForTests({ NODE_ENV: "test" });
  }
});

describe("administrator provider readiness", () => {
  it("treats the development bootstrap lane and its fail-closed gates as intentional", () => {
    const items = buildProviderReadiness({
      environment: baseEnvironment(),
      publicEvidence: emptyPublicEvidence,
      podtrac: podtracEvidence(),
    });

    expect(readinessItem(items, "deployment-mode")).toMatchObject({
      state: "configured",
      stateLabel: "Development bootstrap",
    });
    expect(readinessItem(items, "public-cms-cutover").state).toBe("inactive");
    expect(readinessItem(items, "public-indexing").state).toBe("inactive");
    expect(readinessItem(items, "mailchimp-subscriptions").state).toBe("inactive");
    expect(readinessItem(items, "contact-email").state).toBe("inactive");
  });

  it("validates production cutover attestation and indexing independently", () => {
    const environment = baseEnvironment({
      PASTORWOOD_LAUNCH_STAGE: "production-cutover",
      PASTORWOOD_PUBLIC_URL: "https://www.pastorwood.org",
      PASTORWOOD_ALLOW_INDEXING: "true",
    });
    enablePastorWoodPublicCmsCutoverForTests(environment);

    const items = buildProviderReadiness({
      environment,
      publicEvidence: emptyPublicEvidence,
      podtrac: podtracEvidence(),
    });

    expect(readinessItem(items, "deployment-mode").stateLabel).toBe("Production cutover");
    expect(readinessItem(items, "public-cms-cutover").state).toBe("configured");
    expect(readinessItem(items, "public-indexing").state).toBe("configured");
    disablePastorWoodPublicCmsCutoverForTests(environment);
  });

  it("names missing environment keys exactly without returning any environment values", () => {
    const environment = baseEnvironment();
    const items = buildProviderReadiness({
      environment,
      publicEvidence: emptyPublicEvidence,
      podtrac: podtracEvidence(),
    });

    expect(readinessItem(items, "donation-provider").missingEnvironmentKeys).toEqual([
      "PASTORWOOD_DONATION_URL",
      "PASTORWOOD_DONATION_ALLOWED_HOSTS",
    ]);
    expect(readinessItem(items, "donor-dashboard").missingEnvironmentKeys).toEqual([
      "PASTORWOOD_DONOR_DASHBOARD_URL",
      "PASTORWOOD_DONOR_DASHBOARD_ALLOWED_HOSTS",
    ]);
    expect(readinessItem(items, "mailchimp-subscriptions").missingEnvironmentKeys).toEqual([
      "MAILCHIMP_API_KEY",
      "MAILCHIMP_SERVER_PREFIX",
      "MAILCHIMP_AUDIENCE_ID",
      "MAILCHIMP_WEBHOOK_SECRET",
      "SUBSCRIPTION_RATE_LIMIT_SECRET",
      "SUBSCRIPTION_UNSUBSCRIBE_SECRET",
    ]);
    expect(readinessItem(items, "contact-email").missingEnvironmentKeys).toEqual([
      "CONTACT_EMAIL_SMTP_HOST",
      "CONTACT_EMAIL_SMTP_PORT",
      "CONTACT_EMAIL_SMTP_USERNAME",
      "CONTACT_EMAIL_SMTP_PASSWORD",
      "CONTACT_EMAIL_SMTP_STARTTLS",
      "CONTACT_EMAIL_FROM",
      "CONTACT_EMAIL_TO",
    ]);
  });

  it("distinguishes invalid provider routing values from absent environment keys", () => {
    const environment = baseEnvironment({
      PASTORWOOD_SUBSCRIPTIONS_ENABLED: "true",
      MAILCHIMP_API_KEY: "configured-secret",
      MAILCHIMP_SERVER_PREFIX: "https://invalid.example/path",
      MAILCHIMP_AUDIENCE_ID: "not-an-audience-id",
      MAILCHIMP_WEBHOOK_SECRET: "configured-secret",
      SUBSCRIPTION_RATE_LIMIT_SECRET: "configured-secret",
      SUBSCRIPTION_UNSUBSCRIBE_SECRET: "configured-secret",
    });
    const subscriptions = readinessItem(buildProviderReadiness({
      environment,
      publicEvidence: emptyPublicEvidence,
      podtrac: podtracEvidence(),
    }), "mailchimp-subscriptions");

    expect(subscriptions.state).toBe("invalid");
    expect(subscriptions.missingEnvironmentKeys).toEqual([]);
    expect(subscriptions.invalidEnvironmentKeys).toEqual([
      "MAILCHIMP_SERVER_PREFIX",
      "MAILCHIMP_AUDIENCE_ID",
    ]);
  });

  it("reduces CMS/provider inputs to booleans and never serializes secret or destination values", () => {
    const secret = "SENTINEL_PROVIDER_SECRET_MUST_NOT_RENDER";
    const environment = baseEnvironment({
      PASTORWOOD_DONATION_URL: `https://give.example.org/pay?opaque=${secret}`,
      PASTORWOOD_DONATION_ALLOWED_HOSTS: "give.example.org",
      PASTORWOOD_DONOR_DASHBOARD_URL: `https://account.example.org/portal?opaque=${secret}`,
      PASTORWOOD_DONOR_DASHBOARD_ALLOWED_HOSTS: "account.example.org",
      PASTORWOOD_SUBSCRIPTIONS_ENABLED: "true",
      MAILCHIMP_API_KEY: secret,
      MAILCHIMP_SERVER_PREFIX: "us21",
      MAILCHIMP_AUDIENCE_ID: "9ad7bbba36",
      MAILCHIMP_WEBHOOK_SECRET: secret,
      SUBSCRIPTION_RATE_LIMIT_SECRET: secret,
      SUBSCRIPTION_UNSUBSCRIBE_SECRET: secret,
      CONTACT_EMAIL_DELIVERY_ENABLED: "true",
      CONTACT_EMAIL_SMTP_HOST: "smtp.example.org",
      CONTACT_EMAIL_SMTP_PORT: "587",
      CONTACT_EMAIL_SMTP_USERNAME: secret,
      CONTACT_EMAIL_SMTP_PASSWORD: secret,
      CONTACT_EMAIL_SMTP_STARTTLS: "true",
      CONTACT_EMAIL_FROM: "contact@example.org",
      CONTACT_EMAIL_TO: "office@example.org",
    });
    const publicEvidence = summarizePublicProviderEvidence({
      donateButtonUrl: `https://give.example.org/cms?opaque=${secret}`,
      donorDashboardUrl: `https://account.example.org/cms?opaque=${secret}`,
      subscriptionPublishedEnabled: true,
    }, environment);
    const items = buildProviderReadiness({ environment, publicEvidence, podtrac: podtracEvidence() });
    const serialized = JSON.stringify({ publicEvidence, items });

    expect(publicEvidence).toEqual({
      settingsAvailable: true,
      donationValuePresent: true,
      donationConfigured: true,
      donorDashboardValuePresent: true,
      donorDashboardConfigured: true,
      subscriptionsPublishedEnabled: true,
    });
    expect(readinessItem(items, "donation-provider").state).toBe("configured");
    expect(readinessItem(items, "donor-dashboard").state).toBe("configured");
    expect(readinessItem(items, "mailchimp-subscriptions").state).toBe("configured");
    expect(readinessItem(items, "contact-email").state).toBe("configured");
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("give.example.org");
    expect(serialized).not.toContain("account.example.org");
    expect(serialized).not.toContain("smtp.example.org");
    expect(serialized).not.toContain("SENTINEL_OPERATION_MESSAGE_MUST_NOT_RENDER");
  });

  it("never turns an old successful Podtrac row into a current-auth green claim", () => {
    const staleItems = buildProviderReadiness({
      environment: baseEnvironment(),
      publicEvidence: emptyPublicEvidence,
      podtrac: podtracEvidence({ freshness: "stale", auth: "ok" }),
    });
    const stale = readinessItem(staleItems, "podtrac");
    expect(stale.state).toBe("stale");
    expect(stale.stateLabel).toBe("Stale / auth unverified");
    expect(stale.summary).toContain("current authentication is not verified");
    expect(stale.evidence).toContain("can predate failures that occurred before a run row was inserted");

    const currentItems = buildProviderReadiness({
      environment: baseEnvironment(),
      publicEvidence: emptyPublicEvidence,
      podtrac: podtracEvidence({ freshness: "current", auth: "ok" }),
    });
    expect(readinessItem(currentItems, "podtrac")).toMatchObject({
      state: "unverified",
      stateLabel: "Current data / auth unverified",
    });

    const failedItems = buildProviderReadiness({
      environment: baseEnvironment(),
      publicEvidence: emptyPublicEvidence,
      podtrac: podtracEvidence({ freshness: "stale", auth: "auth-error" }),
    });
    expect(readinessItem(failedItems, "podtrac")).toMatchObject({
      state: "stale",
      stateLabel: "Stale / authentication failed",
      summary: "Podtrac reporting data is stale, and the latest durable sync row proves an authentication failure.",
    });
  });

  it("does not infer off-site backup readiness without app-readable evidence", () => {
    const items = buildProviderReadiness({
      environment: baseEnvironment(),
      publicEvidence: emptyPublicEvidence,
      podtrac: podtracEvidence(),
    });
    expect(readinessItem(items, "offsite-backup")).toMatchObject({
      state: "host-check-required",
      stateLabel: "Host check required",
      summary: "Not verified from this surface.",
      missingEnvironmentKeys: [],
      invalidEnvironmentKeys: [],
    });
  });
});
