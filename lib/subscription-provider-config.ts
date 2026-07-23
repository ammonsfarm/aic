import "server-only";

const REQUIRED_SUBSCRIPTION_PROVIDER_KEYS = [
  "MAILCHIMP_API_KEY",
  "MAILCHIMP_SERVER_PREFIX",
  "MAILCHIMP_AUDIENCE_ID",
  "MAILCHIMP_WEBHOOK_SECRET",
  "SUBSCRIPTION_RATE_LIMIT_SECRET",
  "SUBSCRIPTION_UNSUBSCRIBE_SECRET",
] as const;

export function subscriptionProviderConfigReady(environment: NodeJS.ProcessEnv = process.env) {
  return REQUIRED_SUBSCRIPTION_PROVIDER_KEYS.every((key) => Boolean(environment[key]?.trim()));
}

export function missingSubscriptionProviderConfig(environment: NodeJS.ProcessEnv = process.env) {
  return REQUIRED_SUBSCRIPTION_PROVIDER_KEYS.filter((key) => !environment[key]?.trim());
}
