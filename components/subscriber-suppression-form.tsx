"use client";

import { useState, type FormEvent } from "react";

export function SubscriberSuppressionForm() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/admin/subscriptions/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: new FormData(form).get("email"), status: "suppressed" }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
    setBusy(false);
    setMessage(response.ok ? payload.message || "Subscriber suppressed." : payload.error || "Suppression failed.");
    if (response.ok) form.reset();
  }
  return (
    <form className="stack" onSubmit={submit}>
      <label htmlFor="suppress-subscriber-email">Subscriber email</label>
      <input id="suppress-subscriber-email" name="email" type="email" autoComplete="email" required maxLength={254} />
      <button className="button button--danger" type="submit" disabled={busy}>{busy ? "Suppressing…" : "Suppress subscriber"}</button>
      <p role="status" aria-live="polite">{message}</p>
    </form>
  );
}
