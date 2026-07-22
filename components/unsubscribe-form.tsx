"use client";

import { useState, type FormEvent } from "react";

export function UnsubscribeForm({ token }: { token: string }) {
  const [state, setState] = useState<{ busy: boolean; message: string; error: boolean }>({ busy: false, message: "", error: false });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.busy) return;
    setState({ busy: true, message: "", error: false });
    try {
      const response = await fetch("/api/public/subscriptions/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to unsubscribe.");
      setState({ busy: false, message: payload.message || "You are unsubscribed.", error: false });
    } catch (error) {
      setState({ busy: false, message: error instanceof Error ? error.message : "Unable to unsubscribe.", error: true });
    }
  }

  return (
    <form className="pw-unsubscribe-form" onSubmit={submit}>
      <button className="pw-button" type="submit" disabled={state.busy || (!state.error && Boolean(state.message))}>
        {state.busy ? "Unsubscribing…" : "Confirm unsubscribe"}
      </button>
      <p role="status" aria-live="polite" className={state.error ? "pw-form-error" : ""}>{state.message}</p>
    </form>
  );
}
