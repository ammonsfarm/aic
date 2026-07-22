import Link from "next/link";

import { PageHero, PastorWoodShell } from "@/components/pastor-wood-site";

export default function NotFound() {
  return (
    <PastorWoodShell>
      <PageHero eyebrow="Page not found" title="We could not find that page." body="The address may have changed during the PastorWood site rebuild." />
      <section className="pw-section pw-content-unavailable">
        <h2>Continue with Abiding in Christ</h2>
        <p>Use the public home page, radio archive, or writings library to continue.</p>
        <div className="pw-inline-links"><Link href="/">Home</Link><Link href="/radio/">Radio</Link><Link href="/written-resources/">Writings</Link></div>
      </section>
    </PastorWoodShell>
  );
}
