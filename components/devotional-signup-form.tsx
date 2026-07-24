"use client";

import Link from "next/link";
import { useId, useRef, useState, type FormEvent } from "react";

import { SUBSCRIPTION_CONSENT_TEXT, SUBSCRIPTION_CONSENT_VERSION } from "@/lib/public-subscription-contract";

export function DevotionalSignupForm({
  sourcePath = "/",
  labelledBy,
}: {
  sourcePath?: string;
  labelledBy?: string;
}) {
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [status, setStatus] = useState<{ kind: "idle" | "busy" | "success" | "error"; message: string }>({ kind: "idle", message: "" });
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; consent?: string }>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const generatedId = useId().replace(/:/g, "");
  const emailId = `devotional-email-${generatedId}`;
  const emailErrorId = `${emailId}-error`;
  const consentId = `devotional-consent-${generatedId}`;
  const consentErrorId = `${consentId}-error`;

  function focusField(field: "email" | "consent") {
    window.requestAnimationFrame(() => (field === "email" ? emailRef : consentRef).current?.focus());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status.kind === "busy") return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const consent = data.get("consent") === "yes";
    const validationErrors: { email?: string; consent?: string } = {};
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      validationErrors.email = "Enter a valid email address.";
    }
    if (!consent) {
      validationErrors.consent = "Please agree to receive the weekly devotional.";
    }
    if (validationErrors.email || validationErrors.consent) {
      setFieldErrors(validationErrors);
      setStatus({ kind: "error", message: "Please correct the highlighted field and try again." });
      focusField(validationErrors.email ? "email" : "consent");
      return;
    }
    setFieldErrors({});
    setStatus({ kind: "busy", message: "Subscribing…" });
    try {
      const response = await fetch("/api/public/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          consent,
          consentVersion: SUBSCRIPTION_CONSENT_VERSION,
          website: data.get("website"),
          sourcePath: sourcePath || window.location.pathname,
          startedAt,
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error || "Subscription failed.");
      form.reset();
      setStartedAt(Date.now());
      setFieldErrors({});
      setStatus({ kind: "success", message: payload.message || "Check your email to confirm your subscription." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Subscription failed.";
      if (message === "Enter a valid email address.") {
        setFieldErrors({ email: message });
        focusField("email");
      } else if (message === "Please agree to receive the weekly devotional.") {
        setFieldErrors({ consent: message });
        focusField("consent");
      }
      setStatus({ kind: "error", message });
    }
  }

  return (
    <form className="pw-subscribe-form" onSubmit={submit} noValidate aria-labelledby={labelledBy}>
      <div className="pw-subscribe-form__row">
        <label htmlFor={emailId}>Email address</label>
        <input
          ref={emailRef}
          id={emailId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          required
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? emailErrorId : undefined}
          onInput={() => setFieldErrors((current) => ({ ...current, email: undefined }))}
        />
        <button className="pw-button pw-button--light" type="submit" disabled={status.kind === "busy"}>
          {status.kind === "busy" ? "Subscribing…" : "Subscribe"}
        </button>
        {fieldErrors.email ? <p id={emailErrorId} className="pw-subscribe-form__field-error">{fieldErrors.email}</p> : null}
      </div>
      <label className="pw-subscribe-form__consent" htmlFor={consentId}>
        <input
          ref={consentRef}
          id={consentId}
          name="consent"
          type="checkbox"
          value="yes"
          required
          aria-invalid={Boolean(fieldErrors.consent)}
          aria-describedby={fieldErrors.consent ? consentErrorId : undefined}
          onChange={() => setFieldErrors((current) => ({ ...current, consent: undefined }))}
        />
        <span>{SUBSCRIPTION_CONSENT_TEXT} Read our <Link href="/privacy-terms-conditions/">privacy information</Link>.</span>
      </label>
      {fieldErrors.consent ? <p id={consentErrorId} className="pw-subscribe-form__field-error">{fieldErrors.consent}</p> : null}
      <label className="pw-honeypot" aria-hidden="true">
        Website
        <input name="website" type="text" tabIndex={-1} autoComplete="off" />
      </label>
      <p className={`pw-subscribe-form__status pw-subscribe-form__status--${status.kind}`} role="status" aria-live="polite">
        {status.message}
      </p>
    </form>
  );
}
