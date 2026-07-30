import "server-only";

import { isIP } from "node:net";

import { contactEmailDeliveryReadiness, isValidContactEmailAddress, isValidContactSmtpHost } from "@/lib/contact-email-config";
import type { OperationalDashboard } from "@/lib/admin-operations";
import { validatePastorWoodCutoverAttestation } from "@/lib/pastorwood-cutover-attestation.js";
import { safeExternalDonationUrl, safeExternalDonorDashboardUrl } from "@/lib/public-donation";
import { isPublicIndexingEnabled } from "@/lib/public-seo";
import {
  missingSubscriptionProviderConfig,
  publicSubscriptionCaptureEnabled,
  subscriptionProviderConfigReady,
} from "@/lib/subscription-provider-config";

export const PROVIDER_READINESS_ENV_KEYS = {
  deployment: ["PASTORWOOD_LAUNCH_STAGE"] as const,
  donation: ["PASTORWOOD_DONATION_URL", "PASTORWOOD_DONATION_ALLOWED_HOSTS"] as const,
  donorDashboard: ["PASTORWOOD_DONOR_DASHBOARD_URL", "PASTORWOOD_DONOR_DASHBOARD_ALLOWED_HOSTS"] as const,
  subscriptions: [
    "PASTORWOOD_SUBSCRIPTIONS_ENABLED",
    "MAILCHIMP_API_KEY",
    "MAILCHIMP_SERVER_PREFIX",
    "MAILCHIMP_AUDIENCE_ID",
    "MAILCHIMP_WEBHOOK_SECRET",
    "SUBSCRIPTION_RATE_LIMIT_SECRET",
    "SUBSCRIPTION_UNSUBSCRIBE_SECRET",
  ] as const,
  contactEmail: [
    "CONTACT_EMAIL_DELIVERY_ENABLED",
    "CONTACT_EMAIL_SMTP_HOST",
    "CONTACT_EMAIL_SMTP_PORT",
    "CONTACT_EMAIL_SMTP_USERNAME",
    "CONTACT_EMAIL_SMTP_PASSWORD",
    "CONTACT_EMAIL_SMTP_STARTTLS",
    "CONTACT_EMAIL_FROM",
    "CONTACT_EMAIL_TO",
  ] as const,
  publicCmsCutover: [
    "PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED",
    "PASTORWOOD_CUTOVER_ATTESTATION_SHA256",
    "PASTORWOOD_CUTOVER_PLAN_FINGERPRINT",
    "PASTORWOOD_CUTOVER_MUTATION_MANIFEST_SHA256",
    "PASTORWOOD_DEPLOYED_GIT_REVISION",
  ] as const,
  indexing: ["PASTORWOOD_ALLOW_INDEXING", "PASTORWOOD_PUBLIC_URL"] as const,
} as const;

export type ProviderReadinessState =
  | "configured"
  | "missing"
  | "inactive"
  | "invalid"
  | "stale"
  | "unverified"
  | "host-check-required";

export type ProviderReadinessItem = {
  id: string;
  label: string;
  state: ProviderReadinessState;
  stateLabel: string;
  summary: string;
  evidence: string;
  missingEnvironmentKeys: string[];
  invalidEnvironmentKeys: string[];
};

export type PublicProviderEvidence = {
  settingsAvailable: boolean;
  donationValuePresent: boolean;
  donationConfigured: boolean;
  donorDashboardValuePresent: boolean;
  donorDashboardConfigured: boolean;
  subscriptionsPublishedEnabled: boolean;
};

type PublicSiteSettingsEvidence = {
  donateButtonUrl?: string | null;
  donorDashboardUrl?: string | null;
  subscriptionPublishedEnabled?: boolean;
} | null;

type PodtracReadinessEvidence = Pick<OperationalDashboard, "freshness" | "podtracAuth">;

function value(environment: NodeJS.ProcessEnv, key: string) {
  return environment[key]?.trim() || "";
}

function normalizedFlag(environment: NodeJS.ProcessEnv, key: string) {
  return value(environment, key).toLowerCase();
}

function missingKeys(environment: NodeJS.ProcessEnv, keys: readonly string[]) {
  return keys.filter((key) => !value(environment, key));
}

function item(
  input: Omit<ProviderReadinessItem, "missingEnvironmentKeys" | "invalidEnvironmentKeys"> &
    Partial<Pick<ProviderReadinessItem, "missingEnvironmentKeys" | "invalidEnvironmentKeys">>,
): ProviderReadinessItem {
  return {
    ...input,
    missingEnvironmentKeys: input.missingEnvironmentKeys ?? [],
    invalidEnvironmentKeys: input.invalidEnvironmentKeys ?? [],
  };
}

export function summarizePublicProviderEvidence(
  settings: PublicSiteSettingsEvidence,
  environment: NodeJS.ProcessEnv = process.env,
): PublicProviderEvidence {
  const donationValuePresent = Boolean(settings?.donateButtonUrl?.trim());
  const donorDashboardValuePresent = Boolean(settings?.donorDashboardUrl?.trim());

  return {
    settingsAvailable: Boolean(settings),
    donationValuePresent,
    donationConfigured: Boolean(safeExternalDonationUrl(settings?.donateButtonUrl, environment)),
    donorDashboardValuePresent,
    donorDashboardConfigured: Boolean(safeExternalDonorDashboardUrl(settings?.donorDashboardUrl, environment)),
    subscriptionsPublishedEnabled: settings?.subscriptionPublishedEnabled === true,
  };
}

function deploymentReadiness(environment: NodeJS.ProcessEnv) {
  const stage = value(environment, "PASTORWOOD_LAUNCH_STAGE");
  if (!stage) {
    return item({
      id: "deployment-mode",
      label: "Deployment mode",
      state: "missing",
      stateLabel: "Missing",
      summary: "The launch lane is not declared.",
      evidence: "The runtime cannot distinguish the development bootstrap lane from the reviewed production-cutover lane.",
      missingEnvironmentKeys: ["PASTORWOOD_LAUNCH_STAGE"],
    });
  }
  if (stage !== "development" && stage !== "production-cutover") {
    return item({
      id: "deployment-mode",
      label: "Deployment mode",
      state: "invalid",
      stateLabel: "Invalid",
      summary: "The launch lane is not one of the supported modes.",
      evidence: "Use the existing development or production-cutover contract.",
      invalidEnvironmentKeys: ["PASTORWOOD_LAUNCH_STAGE"],
    });
  }
  if (stage === "development") {
    return item({
      id: "deployment-mode",
      label: "Deployment mode",
      state: "configured",
      stateLabel: "Development bootstrap",
      summary: "The development/bootstrap lane is active by design.",
      evidence: "Static bootstrap content remains the continuity source; CMS cutover and indexing stay behind separate fail-closed gates.",
    });
  }
  return item({
    id: "deployment-mode",
    label: "Deployment mode",
    state: "configured",
    stateLabel: "Production cutover",
    summary: "The production-cutover lane is declared.",
    evidence: "This declaration does not by itself activate CMS authority, indexing, subscriptions, or any provider.",
  });
}

function givingReadiness({
  environment,
  cmsValuePresent,
  cmsConfigured,
  kind,
}: {
  environment: NodeJS.ProcessEnv;
  cmsValuePresent: boolean;
  cmsConfigured: boolean;
  kind: "donation" | "donorDashboard";
}) {
  const donation = kind === "donation";
  const [urlKey, hostsKey] = donation
    ? PROVIDER_READINESS_ENV_KEYS.donation
    : PROVIDER_READINESS_ENV_KEYS.donorDashboard;
  const environmentValuePresent = Boolean(value(environment, urlKey));
  const allowedHostsPresent = Boolean(value(environment, hostsKey));
  const environmentConfigured = donation
    ? Boolean(safeExternalDonationUrl(value(environment, urlKey), environment))
    : Boolean(safeExternalDonorDashboardUrl(value(environment, urlKey), environment));
  const label = donation ? "Donation provider" : "Donor dashboard";
  const providerPurpose = donation ? "secure giving" : "donor account access";

  if (cmsConfigured || environmentConfigured) {
    return item({
      id: kind === "donation" ? "donation-provider" : "donor-dashboard",
      label,
      state: "configured",
      stateLabel: "Configured",
      summary: `A separately hosted HTTPS destination is valid for ${providerPurpose}.`,
      evidence: cmsConfigured ? "Validated from published CMS settings and the purpose-specific host allowlist." : "Validated from the runtime environment and the purpose-specific host allowlist.",
    });
  }

  const missingEnvironmentKeys = [
    ...(!cmsValuePresent && !environmentValuePresent ? [urlKey] : []),
    ...(!allowedHostsPresent ? [hostsKey] : []),
  ];
  if (missingEnvironmentKeys.length > 0) {
    return item({
      id: kind === "donation" ? "donation-provider" : "donor-dashboard",
      label,
      state: "missing",
      stateLabel: "Missing",
      summary: `No valid external destination is available for ${providerPurpose}.`,
      evidence: cmsValuePresent ? "A published CMS destination is present but cannot pass the purpose-specific environment allowlist." : "No published CMS destination or valid environment fallback is available.",
      missingEnvironmentKeys,
    });
  }

  return item({
    id: kind === "donation" ? "donation-provider" : "donor-dashboard",
    label,
    state: "invalid",
    stateLabel: "Invalid",
    summary: `The configured ${providerPurpose} destination fails closed.`,
    evidence: "The destination and purpose-specific allowlist do not form a valid external HTTPS provider contract.",
    invalidEnvironmentKeys: environmentValuePresent ? [urlKey, hostsKey] : [hostsKey],
  });
}

function subscriptionsReadiness(
  environment: NodeJS.ProcessEnv,
  publicEvidence: PublicProviderEvidence,
) {
  const gate = normalizedFlag(environment, "PASTORWOOD_SUBSCRIPTIONS_ENABLED");
  const providerIssueKeys = missingSubscriptionProviderConfig(environment);
  const missingProviderKeys = providerIssueKeys.filter((key) => !value(environment, key));
  const invalidProviderKeys = providerIssueKeys.filter((key) => Boolean(value(environment, key)));
  const missingEnvironmentKeys = [
    ...(!value(environment, "PASTORWOOD_SUBSCRIPTIONS_ENABLED") ? ["PASTORWOOD_SUBSCRIPTIONS_ENABLED"] : []),
    ...missingProviderKeys,
  ];

  if (gate && gate !== "true" && gate !== "false") {
    return item({
      id: "mailchimp-subscriptions",
      label: "Mailchimp subscriptions",
      state: "invalid",
      stateLabel: "Invalid",
      summary: "The public subscription gate is not a valid boolean.",
      evidence: "Subscription capture remains fail-closed.",
      missingEnvironmentKeys: missingProviderKeys,
      invalidEnvironmentKeys: ["PASTORWOOD_SUBSCRIPTIONS_ENABLED", ...invalidProviderKeys],
    });
  }

  if (!publicSubscriptionCaptureEnabled(environment)) {
    return item({
      id: "mailchimp-subscriptions",
      label: "Mailchimp subscriptions",
      state: "inactive",
      stateLabel: "Inactive",
      summary: "Public subscription capture is disabled by its runtime gate.",
      evidence: "This is the expected fail-closed state during development/bootstrap and before provider approval.",
      missingEnvironmentKeys,
      invalidEnvironmentKeys: invalidProviderKeys,
    });
  }

  if (!subscriptionProviderConfigReady(environment) && missingProviderKeys.length > 0) {
    return item({
      id: "mailchimp-subscriptions",
      label: "Mailchimp subscriptions",
      state: "missing",
      stateLabel: "Missing",
      summary: "The runtime gate is on, but the Mailchimp and abuse-prevention contract is incomplete or invalid.",
      evidence: "Public capture remains unavailable until every required provider key passes validation.",
      missingEnvironmentKeys: missingProviderKeys,
      invalidEnvironmentKeys: invalidProviderKeys,
    });
  }

  if (!subscriptionProviderConfigReady(environment)) {
    return item({
      id: "mailchimp-subscriptions",
      label: "Mailchimp subscriptions",
      state: "invalid",
      stateLabel: "Invalid",
      summary: "The runtime gate is on, but provider routing configuration is invalid.",
      evidence: "Public capture remains unavailable until every required provider key passes validation.",
      invalidEnvironmentKeys: invalidProviderKeys,
    });
  }

  if (!publicEvidence.settingsAvailable || !publicEvidence.subscriptionsPublishedEnabled) {
    return item({
      id: "mailchimp-subscriptions",
      label: "Mailchimp subscriptions",
      state: "inactive",
      stateLabel: "Inactive",
      summary: "Provider configuration is valid, but published CMS enablement is not active.",
      evidence: publicEvidence.settingsAvailable ? "The public site-settings result does not enable subscriptions." : "No public site-settings enablement is available from the CMS/projection path.",
    });
  }

  return item({
    id: "mailchimp-subscriptions",
    label: "Mailchimp subscriptions",
    state: "configured",
    stateLabel: "Configured",
    summary: "The runtime gate, provider contract, and published CMS switch are active.",
    evidence: "This confirms configuration readiness, not delivery of any individual confirmation email.",
  });
}

function isLoopbackHost(host: string) {
  const normalized = host.toLowerCase();
  return normalized === "localhost"
    || normalized === "::1"
    || (isIP(normalized) === 4 && normalized.split(".")[0] === "127");
}

function invalidContactEmailKeys(environment: NodeJS.ProcessEnv) {
  const invalid = new Set<string>();
  const host = value(environment, "CONTACT_EMAIL_SMTP_HOST");
  const portText = value(environment, "CONTACT_EMAIL_SMTP_PORT");
  const port = Number(portText);
  const username = value(environment, "CONTACT_EMAIL_SMTP_USERNAME");
  const password = value(environment, "CONTACT_EMAIL_SMTP_PASSWORD");
  const starttls = normalizedFlag(environment, "CONTACT_EMAIL_SMTP_STARTTLS");
  if (host && !isValidContactSmtpHost(host)) invalid.add("CONTACT_EMAIL_SMTP_HOST");
  if (portText && (!/^[0-9]{1,5}$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65_535)) invalid.add("CONTACT_EMAIL_SMTP_PORT");
  if (username && (username.length > 512 || /[\u0000-\u001f\u007f]/.test(username))) invalid.add("CONTACT_EMAIL_SMTP_USERNAME");
  if (password && (password.length > 1024 || /[\u0000-\u001f\u007f]/.test(password))) invalid.add("CONTACT_EMAIL_SMTP_PASSWORD");
  if (starttls && starttls !== "true" && !(starttls === "false" && isLoopbackHost(host))) invalid.add("CONTACT_EMAIL_SMTP_STARTTLS");
  if (value(environment, "CONTACT_EMAIL_FROM") && !isValidContactEmailAddress(value(environment, "CONTACT_EMAIL_FROM"))) invalid.add("CONTACT_EMAIL_FROM");
  if (value(environment, "CONTACT_EMAIL_TO") && !isValidContactEmailAddress(value(environment, "CONTACT_EMAIL_TO"))) invalid.add("CONTACT_EMAIL_TO");
  return [...invalid];
}

function contactEmailReadiness(environment: NodeJS.ProcessEnv) {
  const gate = normalizedFlag(environment, "CONTACT_EMAIL_DELIVERY_ENABLED");
  const smtpKeys = PROVIDER_READINESS_ENV_KEYS.contactEmail.slice(1);
  const missingSmtpKeys = missingKeys(environment, smtpKeys);
  const missingEnvironmentKeys = [
    ...(!value(environment, "CONTACT_EMAIL_DELIVERY_ENABLED") ? ["CONTACT_EMAIL_DELIVERY_ENABLED"] : []),
    ...missingSmtpKeys,
  ];

  if (gate && gate !== "true" && gate !== "false") {
    return item({
      id: "contact-email",
      label: "Contact email delivery",
      state: "invalid",
      stateLabel: "Invalid",
      summary: "The contact-email delivery gate is not a valid boolean.",
      evidence: "Contact submissions still remain durably available in the protected inbox.",
      missingEnvironmentKeys: missingSmtpKeys,
      invalidEnvironmentKeys: ["CONTACT_EMAIL_DELIVERY_ENABLED"],
    });
  }

  if (gate !== "true") {
    return item({
      id: "contact-email",
      label: "Contact email delivery",
      state: "inactive",
      stateLabel: "Inactive",
      summary: "SMTP notification delivery is disabled by its runtime gate.",
      evidence: "Contact capture is still durable; accepted messages remain in the protected inbox without a delivery claim.",
      missingEnvironmentKeys,
    });
  }

  const readiness = contactEmailDeliveryReadiness(environment);
  if (readiness.reason === "incomplete") {
    return item({
      id: "contact-email",
      label: "Contact email delivery",
      state: "missing",
      stateLabel: "Missing",
      summary: "SMTP delivery is enabled, but required configuration is missing.",
      evidence: "The worker remains fail-closed until the complete provider contract is present.",
      missingEnvironmentKeys: missingSmtpKeys,
    });
  }
  if (!readiness.ready) {
    return item({
      id: "contact-email",
      label: "Contact email delivery",
      state: "invalid",
      stateLabel: "Invalid",
      summary: "SMTP delivery is enabled, but configured fields fail validation.",
      evidence: "The worker remains fail-closed; no provider destination or credential value is shown here.",
      invalidEnvironmentKeys: invalidContactEmailKeys(environment),
    });
  }
  return item({
    id: "contact-email",
    label: "Contact email delivery",
    state: "configured",
    stateLabel: "Configured",
    summary: "The SMTP delivery gate and provider contract are valid.",
    evidence: "This confirms configuration readiness only; SMTP acceptance and recipient delivery remain separate outcomes.",
  });
}

function publicCmsCutoverReadiness(environment: NodeJS.ProcessEnv) {
  const gate = normalizedFlag(environment, "PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED");
  const evidenceKeys = PROVIDER_READINESS_ENV_KEYS.publicCmsCutover.slice(1);
  const missingEvidenceKeys = missingKeys(environment, evidenceKeys);
  const missingEnvironmentKeys = [
    ...(!value(environment, "PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED") ? ["PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED"] : []),
    ...missingEvidenceKeys,
  ];

  if (gate && gate !== "true" && gate !== "false") {
    return item({
      id: "public-cms-cutover",
      label: "Public CMS cutover",
      state: "invalid",
      stateLabel: "Invalid",
      summary: "The public CMS cutover gate is not a valid boolean.",
      evidence: "Bootstrap/static content remains authoritative.",
      missingEnvironmentKeys: missingEvidenceKeys,
      invalidEnvironmentKeys: ["PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED"],
    });
  }
  if (gate !== "true") {
    return item({
      id: "public-cms-cutover",
      label: "Public CMS cutover",
      state: "inactive",
      stateLabel: "Inactive",
      summary: "Public CMS authority is disabled by its fail-closed gate.",
      evidence: "Bootstrap/static content remains authoritative; draft or published CMS records alone do not activate public routing.",
      missingEnvironmentKeys,
    });
  }
  if (missingEvidenceKeys.length > 0) {
    return item({
      id: "public-cms-cutover",
      label: "Public CMS cutover",
      state: "missing",
      stateLabel: "Missing",
      summary: "The cutover gate is on, but its bound attestation environment is incomplete.",
      evidence: "Public CMS authority remains fail-closed.",
      missingEnvironmentKeys: missingEvidenceKeys,
    });
  }
  const attestation = validatePastorWoodCutoverAttestation(environment);
  if (!attestation.ok) {
    return item({
      id: "public-cms-cutover",
      label: "Public CMS cutover",
      state: "invalid",
      stateLabel: "Invalid",
      summary: "The cutover gate is on, but its bound attestation is not valid.",
      evidence: attestation.reason,
      invalidEnvironmentKeys: [...evidenceKeys],
    });
  }
  return item({
    id: "public-cms-cutover",
    label: "Public CMS cutover",
    state: "configured",
    stateLabel: "Configured",
    summary: "The explicit cutover gate and immutable attestation validate.",
    evidence: "Published CMS/projection state is eligible to serve as public authority.",
  });
}

function indexingReadiness(environment: NodeJS.ProcessEnv) {
  const gate = normalizedFlag(environment, "PASTORWOOD_ALLOW_INDEXING");
  if (gate && gate !== "true" && gate !== "false") {
    return item({
      id: "public-indexing",
      label: "Public indexing",
      state: "invalid",
      stateLabel: "Invalid",
      summary: "The indexing gate is not a valid boolean.",
      evidence: "Search indexing remains fail-closed.",
      invalidEnvironmentKeys: ["PASTORWOOD_ALLOW_INDEXING"],
    });
  }
  if (isPublicIndexingEnabled(environment)) {
    return item({
      id: "public-indexing",
      label: "Public indexing",
      state: "configured",
      stateLabel: "Configured",
      summary: "Indexing is enabled for the canonical production origin.",
      evidence: "The indexing flag and public origin both satisfy the runtime safety gate.",
    });
  }
  const missingEnvironmentKeys = missingKeys(environment, PROVIDER_READINESS_ENV_KEYS.indexing);
  return item({
    id: "public-indexing",
    label: "Public indexing",
    state: "inactive",
    stateLabel: "Inactive",
    summary: "Public indexing is disabled or blocked by the canonical-origin safety check.",
    evidence: "This is intentional in development/bootstrap. Enabling the flag alone cannot index a non-canonical origin.",
    missingEnvironmentKeys,
    invalidEnvironmentKeys: gate === "true" && value(environment, "PASTORWOOD_PUBLIC_URL")
      ? ["PASTORWOOD_PUBLIC_URL"]
      : [],
  });
}

function formatEvidenceDate(value: string | null) {
  if (!value) return "not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "recorded with an invalid timestamp";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(parsed);
}

function podtracReadiness(podtrac: PodtracReadinessEvidence) {
  const freshness = podtrac.freshness.podtrac;
  const auth = podtrac.podtracAuth;
  const freshnessEvidence = freshness.dataCurrentThrough
    ? `Database activity is current through ${freshness.dataCurrentThrough}; lag is ${freshness.lagDays ?? "unknown"} day(s) against a ${freshness.slaDays}-day SLA.`
    : `No database activity freshness date is recorded; the SLA is ${freshness.slaDays} day(s).`;
  const authEvidence = auth.state === "auth-error"
    ? `The latest durable sync row records an authentication failure at ${formatEvidenceDate(auth.checkedAt)}.`
    : auth.state === "ok"
      ? `The latest durable sync row completed without an authentication error at ${formatEvidenceDate(auth.checkedAt)}, but it can predate failures that occurred before a run row was inserted.`
      : `No current authentication result is proven by durable sync rows; the latest check time is ${formatEvidenceDate(auth.checkedAt)}.`;

  if (auth.state === "auth-error") {
    return item({
      id: "podtrac",
      label: "Podtrac reporting",
      state: freshness.state === "stale" ? "stale" : "invalid",
      stateLabel: freshness.state === "stale"
        ? "Stale / authentication failed"
        : freshness.state === "missing"
          ? "Authentication failed / data missing"
          : "Authentication failed",
      summary: freshness.state === "stale"
        ? "Podtrac reporting data is stale, and the latest durable sync row proves an authentication failure."
        : "The latest durable Podtrac sync row proves an authentication failure.",
      evidence: `${freshnessEvidence} ${authEvidence}`,
    });
  }

  if (freshness.state === "stale") {
    return item({
      id: "podtrac",
      label: "Podtrac reporting",
      state: "stale",
      stateLabel: "Stale / auth unverified",
      summary: "Podtrac reporting data is stale, and current authentication is not verified from this surface.",
      evidence: `${freshnessEvidence} ${authEvidence}`,
    });
  }
  if (freshness.state === "missing") {
    return item({
      id: "podtrac",
      label: "Podtrac reporting",
      state: "unverified",
      stateLabel: "Missing / auth unverified",
      summary: "No durable Podtrac freshness evidence is available, and current authentication is not verified.",
      evidence: `${freshnessEvidence} ${authEvidence}`,
    });
  }
  return item({
    id: "podtrac",
    label: "Podtrac reporting",
    state: "unverified",
    stateLabel: "Current data / auth unverified",
    summary: "Recorded data is within its SLA, but current provider authentication is not independently verified.",
    evidence: `${freshnessEvidence} ${authEvidence}`,
  });
}

function offsiteBackupReadiness() {
  return item({
    id: "offsite-backup",
    label: "Off-site backup",
    state: "host-check-required",
    stateLabel: "Host check required",
    summary: "Not verified from this surface.",
    evidence: "The application has no trustworthy app-readable off-site replication success or freshness record. Verify the host timer/service, journal, encrypted remote listing, and restore evidence directly.",
  });
}

export function buildProviderReadiness({
  environment = process.env,
  publicEvidence,
  podtrac,
}: {
  environment?: NodeJS.ProcessEnv;
  publicEvidence: PublicProviderEvidence;
  podtrac: PodtracReadinessEvidence;
}) {
  return [
    deploymentReadiness(environment),
    givingReadiness({ environment, cmsValuePresent: publicEvidence.donationValuePresent, cmsConfigured: publicEvidence.donationConfigured, kind: "donation" }),
    givingReadiness({ environment, cmsValuePresent: publicEvidence.donorDashboardValuePresent, cmsConfigured: publicEvidence.donorDashboardConfigured, kind: "donorDashboard" }),
    subscriptionsReadiness(environment, publicEvidence),
    contactEmailReadiness(environment),
    publicCmsCutoverReadiness(environment),
    indexingReadiness(environment),
    podtracReadiness(podtrac),
    offsiteBackupReadiness(),
  ];
}
