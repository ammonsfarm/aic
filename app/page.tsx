import Link from "next/link";
import { TopRail } from "@/components/top-rail";
import { MountainPanel } from "@/components/mountain-panel";

export default function Home() {
  return (
    <>
      <TopRail variant="public" />
      <main className="public-shell">
        <MountainPanel
          eyebrow="Public episode site"
          title="Abiding in Christ"
          body="A public archive shell for approved episodes, scripture references, topics, and summaries. Private stats, pipeline state, and source logs stay behind the console."
          scene="chapel"
        />
        <section className="public-band">
          <div>
            <p className="eyebrow">Private workspace</p>
            <h2>Owner console access</h2>
            <p>
              The Mountain Study Console is protected. Sign in to review stats, source traces, drafts,
              and pipeline status.
            </p>
          </div>
          <Link className="button button--primary" href="/overview">Open console</Link>
        </section>
      </main>
    </>
  );
}
