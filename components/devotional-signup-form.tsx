"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { SUBSCRIPTION_CONSENT_TEXT, SUBSCRIPTION_CONSENT_VERSION } from "@/lib/public-subscription-contract";

export function DevotionalSignupForm({ sourcePath = "/" }: { sourcePath?: string }) {
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [status, setStatus] = useState<{ kind: "idle" | "busy" | "success" | "error"; message: string }>({ kind: "idle", message: "" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status.kind === "busy") return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus({ kind: "busy", message: "Subscribing…" });
    try {
      const response = await fetch("/api/public/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          consent: data.get("consent") === "yes",
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
      setStatus({ kind: "success", message: payload.message || "You are subscribed." });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Subscription failed." });
    }
  }

  return (
    <form className="pw-subscribe-form" onSubmit={submit} noValidate>
      <div className="pw-subscribe-form__row">
        <label htmlFor="devotional-email">Email address</label>
        <input id="devotional-email" name="email" type="email" inputMode="email" autoComplete="email" maxLength={254} required />
        <button className="pw-button pw-button--light" type="submit" disabled={status.kind === "busy"}>
          {status.kind === "busy" ? "Subscribing…" : "Subscribe"}
        </button>
      </div>
      <label className="pw-subscribe-form__consent">
        <input name="consent" type="checkbox" value="yes" required />
        <span>{SUBSCRIPTION_CONSENT_TEXT} Read our <Link href="/privacy-terms-conditions/">privacy information</Link>.</span>
      </label>
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
