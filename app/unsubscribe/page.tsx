import type { Metadata } from "next";

import { PastorWoodShell } from "@/components/pastor-wood-site";
import { UnsubscribeForm } from "@/components/unsubscribe-form";
import { publicMetadata } from "@/lib/public-seo";

export const metadata: Metadata = {
  ...publicMetadata({
    title: "Unsubscribe from the Weekly Devotional",
    description: "Stop receiving the Abiding in Christ weekly devotional.",
    path: "/unsubscribe/",
  }),
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token?.trim() || "";
  return (
    <PastorWoodShell>
      <main className="pw-section pw-writing-detail">
        <p className="pw-eyebrow">Email preferences</p>
        <h1>Unsubscribe from the weekly devotional</h1>
        <p>Confirm below to stop future Abiding in Christ devotional email at the address associated with this secure link.</p>
        {token ? <UnsubscribeForm token={token} /> : <p className="pw-form-error">This unsubscribe link is incomplete.</p>}
      </main>
    </PastorWoodShell>
  );
}
