import "server-only";

const REQUIRED_SUBSCRIPTION_PROVIDER_KEYS = [
  "MAILCHIMP_API_KEY",
  "MAILCHIMP_SERVER_PREFIX",
  "MAILCHIMP_AUDIENCE_ID",
  "MAILCHIMP_WEBHOOK_SECRET",
  "SUBSCRIPTION_RATE_LIMIT_SECRET",
  "SUBSCRIPTION_UNSUBSCRIBE_SECRET",
] as const;

const MAILCHIMP_SERVER_PREFIX_PATTERN = /^[a-z0-9-]{2,24}$/;
const MAILCHIMP_AUDIENCE_ID_PATTERN = /^[a-f0-9]{10,32}$/i;

export function subscriptionProviderConfigReady(environment: NodeJS.ProcessEnv = process.env) {
  if (!REQUIRED_SUBSCRIPTION_PROVIDER_KEYS.every((key) => Boolean(environment[key]?.trim()))) {
    return false;
  }
  return MAILCHIMP_SERVER_PREFIX_PATTERN.test(environment.MAILCHIMP_SERVER_PREFIX!.trim().toLowerCase())
    && MAILCHIMP_AUDIENCE_ID_PATTERN.test(environment.MAILCHIMP_AUDIENCE_ID!.trim());
}

export function missingSubscriptionProviderConfig(environment: NodeJS.ProcessEnv = process.env) {
  return REQUIRED_SUBSCRIPTION_PROVIDER_KEYS.filter((key) => {
    const value = environment[key]?.trim() || "";
    if (!value) return true;
    if (key === "MAILCHIMP_SERVER_PREFIX") return !MAILCHIMP_SERVER_PREFIX_PATTERN.test(value.toLowerCase());
    if (key === "MAILCHIMP_AUDIENCE_ID") return !MAILCHIMP_AUDIENCE_ID_PATTERN.test(value);
    return false;
  });
}
