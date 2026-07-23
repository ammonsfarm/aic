"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function SubscriptionProviderRetryForm({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<{ kind: "idle" | "busy" | "success" | "error"; message: string }>({ kind: "idle", message: "" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || status.kind === "busy") return;
    setStatus({ kind: "busy", message: "Queueing retries…" });
    try {
      const response = await fetch("/api/admin/subscriptions/provider/retry", { method: "POST" });
      const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error || "Provider retries could not be queued.");
      setStatus({ kind: "success", message: payload.message || "Provider retries queued." });
      router.refresh();
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Provider retries could not be queued." });
    }
  }

  return (
    <form onSubmit={submit} className="stack stack--compact">
      <button className="button button--ghost" type="submit" disabled={disabled || status.kind === "busy"}>
        {status.kind === "busy" ? "Queueing…" : "Retry failed provider syncs"}
      </button>
      <p className="muted-copy" role="status" aria-live="polite">{status.message}</p>
    </form>
  );
}
