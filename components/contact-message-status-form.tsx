"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  CONTACT_MESSAGE_STATUSES,
  CONTACT_MESSAGE_STATUS_LABELS,
  type ContactMessageStatus,
} from "@/lib/public-contact-contract";

export function ContactMessageStatusForm({
  publicId,
  currentStatus,
  expectedUpdatedAt,
}: {
  publicId: string;
  currentStatus: ContactMessageStatus;
  expectedUpdatedAt: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/contact-messages/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicId,
          status: data.get("status"),
          expectedUpdatedAt,
          note: data.get("note"),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error || "Status update failed.");
      setMessage(payload.message || "Status updated.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Status update failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="editor-form" onSubmit={submit}>
      <label>
        <span>Workflow status</span>
        <select name="status" defaultValue={currentStatus}>
          {CONTACT_MESSAGE_STATUSES.map((status) => (
            <option value={status} key={status}>{CONTACT_MESSAGE_STATUS_LABELS[status]}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Change note <small>(optional)</small></span>
        <textarea name="note" rows={3} maxLength={500} />
      </label>
      <div className="editor-form__actions">
        <button className="button" type="submit" disabled={busy}>{busy ? "Saving…" : "Update status"}</button>
        <p className="muted-copy" role="status" aria-live="polite">{message}</p>
      </div>
    </form>
  );
}
