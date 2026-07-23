"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";

import { SUBSCRIPTION_CONSENT_TEXT, SUBSCRIPTION_CONSENT_VERSION } from "@/lib/public-subscription-contract";

export function DevotionalSignupForm({ sourcePath = "/" }: { sourcePath?: string }) {
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [status, setStatus] = useState<{ kind: "idle" | "busy" | "success" | "error"; message: string }>({ kind: "idle", message: "" });
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; consent?: string }>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);

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
          sourcePath,
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
    <form className="pw-subscribe-form" onSubmit={submit} noValidate>
      <div className="pw-subscribe-form__row">
        <label htmlFor="devotional-email">Email address</label>
        <input
          ref={emailRef}
          id="devotional-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          required
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "devotional-email-error" : undefined}
          onInput={() => setFieldErrors((current) => ({ ...current, email: undefined }))}
        />
        <button className="pw-button pw-button--light" type="submit" disabled={status.kind === "busy"}>
          {status.kind === "busy" ? "Subscribing…" : "Subscribe"}
        </button>
        {fieldErrors.email ? <p id="devotional-email-error" className="pw-subscribe-form__field-error">{fieldErrors.email}</p> : null}
      </div>
      <label className="pw-subscribe-form__consent" htmlFor="devotional-consent">
        <input
          ref={consentRef}
          id="devotional-consent"
          name="consent"
          type="checkbox"
          value="yes"
          required
          aria-invalid={Boolean(fieldErrors.consent)}
          aria-describedby={fieldErrors.consent ? "devotional-consent-error" : undefined}
          onChange={() => setFieldErrors((current) => ({ ...current, consent: undefined }))}
        />
        <span>{SUBSCRIPTION_CONSENT_TEXT} Read our <Link href="/privacy-terms-conditions/">privacy information</Link>.</span>
      </label>
      {fieldErrors.consent ? <p id="devotional-consent-error" className="pw-subscribe-form__field-error">{fieldErrors.consent}</p> : null}
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
