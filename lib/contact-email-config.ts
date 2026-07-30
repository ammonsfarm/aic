import "server-only";

import { isIP } from "node:net";

const SMTP_CONFIG_KEYS = [
  "CONTACT_EMAIL_SMTP_HOST",
  "CONTACT_EMAIL_SMTP_PORT",
  "CONTACT_EMAIL_SMTP_USERNAME",
  "CONTACT_EMAIL_SMTP_PASSWORD",
  "CONTACT_EMAIL_SMTP_STARTTLS",
  "CONTACT_EMAIL_FROM",
  "CONTACT_EMAIL_TO",
] as const;

function value(environment: NodeJS.ProcessEnv, key: string) {
  return environment[key]?.trim() || "";
}

function hasControlCharacters(input: string) {
  return /[\u0000-\u001f\u007f]/.test(input);
}

export function isValidContactSmtpHost(input: string) {
  if (!input || input.length > 253 || hasControlCharacters(input) || /[\s/\\]/.test(input)) return false;
  if (isIP(input)) return true;
  return input.split(".").every((label) =>
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label),
  );
}

export function isValidContactEmailAddress(input: string) {
  if (!input || input.length > 254 || hasControlCharacters(input) || !/^[\x20-\x7e]+$/.test(input)) return false;
  const parts = input.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !/^[A-Za-z0-9.!#$%&'*+/=?^_{|}~-]+$/.test(local)) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  return isValidContactSmtpHost(domain) && domain.includes(".");
}

function isLoopbackHost(input: string) {
  const normalized = input.toLowerCase();
  const addressKind = isIP(normalized);
  return normalized === "localhost"
    || normalized === "::1"
    || (addressKind === 4 && normalized.split(".")[0] === "127");
}

export type ContactEmailDeliveryReadiness = {
  ready: boolean;
  reason: "ready" | "disabled" | "incomplete" | "invalid";
};

export function contactEmailDeliveryReadiness(
  environment: NodeJS.ProcessEnv = process.env,
): ContactEmailDeliveryReadiness {
  const enabled = value(environment, "CONTACT_EMAIL_DELIVERY_ENABLED").toLowerCase();
  if (enabled !== "true") {
    return { ready: false, reason: enabled === "" || enabled === "false" ? "disabled" : "invalid" };
  }
  if (SMTP_CONFIG_KEYS.some((key) => !value(environment, key))) {
    return { ready: false, reason: "incomplete" };
  }

  const host = value(environment, "CONTACT_EMAIL_SMTP_HOST");
  const portText = value(environment, "CONTACT_EMAIL_SMTP_PORT");
  const port = Number(portText);
  const starttls = value(environment, "CONTACT_EMAIL_SMTP_STARTTLS").toLowerCase();
  const username = value(environment, "CONTACT_EMAIL_SMTP_USERNAME");
  const password = value(environment, "CONTACT_EMAIL_SMTP_PASSWORD");
  const credentialsValid = username.length <= 512
    && password.length <= 1024
    && !hasControlCharacters(username)
    && !hasControlCharacters(password);
  const tlsValid = starttls === "true" || (starttls === "false" && isLoopbackHost(host));
  const ready = isValidContactSmtpHost(host)
    && /^[0-9]{1,5}$/.test(portText)
    && Number.isInteger(port)
    && port >= 1
    && port <= 65_535
    && credentialsValid
    && tlsValid
    && isValidContactEmailAddress(value(environment, "CONTACT_EMAIL_FROM"))
    && isValidContactEmailAddress(value(environment, "CONTACT_EMAIL_TO"));
  return { ready, reason: ready ? "ready" : "invalid" };
}

export function contactEmailDeliveryReady(environment: NodeJS.ProcessEnv = process.env) {
  return contactEmailDeliveryReadiness(environment).ready;
}
