import { describe, expect, it } from "vitest";

import {
  contactEmailDeliveryReadiness,
  isValidContactEmailAddress,
  isValidContactSmtpHost,
} from "@/lib/contact-email-config";

function completeConfig(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    CONTACT_EMAIL_DELIVERY_ENABLED: "true",
    CONTACT_EMAIL_SMTP_HOST: "smtp.example.org",
    CONTACT_EMAIL_SMTP_PORT: "587",
    CONTACT_EMAIL_SMTP_USERNAME: "smtp-user",
    CONTACT_EMAIL_SMTP_PASSWORD: "test-only-password",
    CONTACT_EMAIL_SMTP_STARTTLS: "true",
    CONTACT_EMAIL_FROM: "contact@example.org",
    CONTACT_EMAIL_TO: "office@example.org",
    ...overrides,
  };
}

describe("contact email delivery readiness", () => {
  it("fails closed while disabled or incomplete", () => {
    expect(contactEmailDeliveryReadiness({})).toEqual({ ready: false, reason: "disabled" });
    expect(contactEmailDeliveryReadiness(completeConfig({
      CONTACT_EMAIL_DELIVERY_ENABLED: "false",
    }))).toEqual({ ready: false, reason: "disabled" });
    expect(contactEmailDeliveryReadiness(completeConfig({
      CONTACT_EMAIL_TO: "",
    }))).toEqual({ ready: false, reason: "incomplete" });
    expect(contactEmailDeliveryReadiness(completeConfig({
      CONTACT_EMAIL_DELIVERY_ENABLED: "yes",
    }))).toEqual({ ready: false, reason: "invalid" });
  });

  it("requires one bounded host, port, credential pair, sender, and destination", () => {
    expect(contactEmailDeliveryReadiness(completeConfig())).toEqual({ ready: true, reason: "ready" });
    expect(contactEmailDeliveryReadiness(completeConfig({
      CONTACT_EMAIL_SMTP_PORT: "70000",
    }))).toEqual({ ready: false, reason: "invalid" });
    expect(contactEmailDeliveryReadiness(completeConfig({
      CONTACT_EMAIL_TO: "Office <office@example.org>",
    }))).toEqual({ ready: false, reason: "invalid" });
    expect(isValidContactEmailAddress("office@example.org")).toBe(true);
    expect(isValidContactEmailAddress("office@example.org\r\nBcc: attacker@example.org")).toBe(false);
    expect(isValidContactSmtpHost("smtp.example.org")).toBe(true);
    expect(isValidContactSmtpHost("smtp.example.org/path")).toBe(false);
  });

  it("allows plaintext SMTP only for a parsed loopback address or localhost", () => {
    expect(contactEmailDeliveryReadiness(completeConfig({
      CONTACT_EMAIL_SMTP_HOST: "127.0.0.1",
      CONTACT_EMAIL_SMTP_STARTTLS: "false",
    }))).toEqual({ ready: true, reason: "ready" });
    expect(contactEmailDeliveryReadiness(completeConfig({
      CONTACT_EMAIL_SMTP_HOST: "localhost",
      CONTACT_EMAIL_SMTP_STARTTLS: "false",
    }))).toEqual({ ready: true, reason: "ready" });
    expect(contactEmailDeliveryReadiness(completeConfig({
      CONTACT_EMAIL_SMTP_HOST: "127.evil",
      CONTACT_EMAIL_SMTP_STARTTLS: "false",
    }))).toEqual({ ready: false, reason: "invalid" });
    expect(contactEmailDeliveryReadiness(completeConfig({
      CONTACT_EMAIL_SMTP_HOST: "smtp.example.org",
      CONTACT_EMAIL_SMTP_STARTTLS: "false",
    }))).toEqual({ ready: false, reason: "invalid" });
  });
});
