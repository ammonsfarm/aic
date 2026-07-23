"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  CONTACT_CONSENT_TEXT,
  CONTACT_CONSENT_VERSION,
} from "@/lib/public-contact-contract";

type ContactFormState = { kind: "idle" | "busy" | "success" | "error"; message: string };

export function PublicContactForm({ sourcePath = "/contact/" }: { sourcePath?: string }) {
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [status, setStatus] = useState<ContactFormState>({ kind: "idle", message: "" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status.kind === "busy") return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus({ kind: "busy", message: "Sending your message…" });
    try {
      const response = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: data.get("category"),
          name: data.get("name"),
          email: data.get("email"),
          phone: data.get("phone"),
          organization: data.get("organization"),
          subject: data.get("subject"),
          message: data.get("message"),
          consent: data.get("consent") === "yes",
          consentVersion: CONTACT_CONSENT_VERSION,
          website: data.get("website"),
          sourcePath,
          startedAt,
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error || "Your message could not be submitted.");
      form.reset();
      setStartedAt(Date.now());
      setStatus({ kind: "success", message: payload.message || "Your message was received." });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Your message could not be submitted.",
      });
    }
  }

  return (
    <section className="pw-section pw-contact-form-section" aria-labelledby="contact-form-title">
      <div className="pw-contact-form-section__intro">
        <p className="pw-kicker">Send a message</p>
        <h2 id="contact-form-title">How may we help?</h2>
        <p>Use this form for feedback, prayer requests, speaking invitations, or general ministry correspondence.</p>
        <p><strong>Please do not use this form for emergencies or include financial, medical, or other highly sensitive details.</strong></p>
      </div>
      <form className="pw-contact-form" onSubmit={submit}>
        <div className="pw-contact-form__grid">
          <label>
            <span>Message type</span>
            <select name="category" defaultValue="general" required>
              {CONTACT_CATEGORIES.map((category) => (
                <option key={category} value={category}>{CONTACT_CATEGORY_LABELS[category]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Name</span>
            <input name="name" type="text" autoComplete="name" minLength={2} maxLength={120} required />
          </label>
          <label>
            <span>Email address</span>
            <input name="email" type="email" inputMode="email" autoComplete="email" maxLength={254} required />
          </label>
          <label>
            <span>Phone <small>(optional)</small></span>
            <input name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} />
          </label>
          <label className="pw-contact-form__wide">
            <span>Organization <small>(optional)</small></span>
            <input name="organization" type="text" autoComplete="organization" maxLength={160} />
          </label>
          <label className="pw-contact-form__wide">
            <span>Subject</span>
            <input name="subject" type="text" minLength={3} maxLength={160} required />
          </label>
          <label className="pw-contact-form__wide">
            <span>Message</span>
            <textarea name="message" rows={8} minLength={10} maxLength={5000} required />
          </label>
        </div>
        <label className="pw-contact-form__consent">
          <input name="consent" type="checkbox" value="yes" required />
          <span>{CONTACT_CONSENT_TEXT} Read our <Link href="/privacy-terms-conditions/">privacy information</Link>.</span>
        </label>
        <label className="pw-honeypot" aria-hidden="true">
          Website
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
        <button className="pw-button pw-button--primary" type="submit" disabled={status.kind === "busy"}>
          {status.kind === "busy" ? "Sending…" : "Send message"}
        </button>
        <p className={`pw-contact-form__status pw-contact-form__status--${status.kind}`} role="status" aria-live="polite">
          {status.message}
        </p>
      </form>
    </section>
  );
}
