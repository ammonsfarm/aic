import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";
import { PastorWoodSite } from "@/components/pastor-wood-site";
import { TopRail } from "@/components/top-rail";
import { MountainPanel } from "@/components/mountain-panel";
import { isCurrentUserAdministrator } from "@/lib/rbac";

function isPastorWoodHost(host: string | null) {
  const normalized = (host ?? "").split(":")[0].toLowerCase();
  return normalized === "pastorwood.ammonsfarm.org" || normalized === "www.pastorwood.ammonsfarm.org";
}

export default async function Home() {
  const requestHeaders = await headers();
  if (isPastorWoodHost(requestHeaders.get("host"))) {
    return <PastorWoodSite />;
  }

  const isAdministrator = await isCurrentUserAdministrator();

  return (
    <>
      <TopRail variant="public" />
      <main className="public-shell">

        {/* ── Hero ─────────────────────────────────────────────────── */}
        <MountainPanel
          eyebrow="Abiding in Christ Radio"
          title="Pastor Jim Wood"
          body="Whether interviewing guests about current events or preaching directly from the Bible, Pastor Wood encourages his listeners to follow Jesus Christ in whole-hearted obedience."
          scene="chapel"
        />

        {/* ── Bio band ─────────────────────────────────────────────── */}
        <section className="public-band public-bio-band">
          <div className="public-bio-photo">
            <Image
              src="/images/pastor-wood.jpg"
              alt="Pastor Jim Wood"
              width={160}
              height={200}
              className="bio-portrait"
            />
          </div>
          <div className="public-bio-copy">
            <p className="eyebrow">Brief Bio</p>
            <h2>Jim Wood — Founder, Preacher, Author</h2>
            <p>
              Pastor Jim Wood is passionate about sharing the gospel. He wrote his first sermon at nine,
              began preaching at fifteen, and has been preaching and teaching the Bible for over fifty years.
              Jim is the Founder of{" "}
              <a href="https://wvr.org/" className="text-link" target="_blank" rel="noopener">
                Wears Valley Ranch
              </a>
              , a home and school for children from families in crisis. He and his wife Susan have been
              married for over 50 years and have 7 children and 15 grandchildren.
            </p>
            <div className="bio-actions">
              <a
                className="button button--primary"
                href="https://www.pastorwood.org/about-pastor-wood/"
                target="_blank"
                rel="noopener"
              >
                Full Biography →
              </a>
              <a
                className="button button--ghost"
                href="https://www.pastorwood.org/donate/"
                target="_blank"
                rel="noopener"
              >
                Support the Ministry
              </a>
            </div>
          </div>
        </section>

        {/* ── Listen section ───────────────────────────────────────── */}
        <section className="public-listen-grid">
          <a
            href="https://itunes.apple.com/us/podcast/abiding-in-christ-w-jim-wood/id375149712?mt=2"
            target="_blank"
            rel="noopener"
            className="listen-card"
          >
            <span className="listen-card__icon">🎙️</span>
            <strong>Apple Podcasts</strong>
            <span>Subscribe to Abiding in Christ on iTunes / Apple Podcasts</span>
          </a>
          <a
            href="https://www.pastorwood.org/radio"
            target="_blank"
            rel="noopener"
            className="listen-card"
          >
            <span className="listen-card__icon">📻</span>
            <strong>SiriusXM Family Talk 131</strong>
            <span>Monday – Friday, 8:30 PM EST on Salem Media&apos;s Family Talk</span>
          </a>
          <a
            href="https://www.pastorwood.org/bible-study/"
            target="_blank"
            rel="noopener"
            className="listen-card"
          >
            <span className="listen-card__icon">📖</span>
            <strong>Weekly Devotional</strong>
            <span>Receive weekly encouragement as you walk with Christ</span>
          </a>
          <a
            href="https://wvr.org/bookstore/"
            target="_blank"
            rel="noopener"
            className="listen-card"
          >
            <span className="listen-card__icon">📚</span>
            <strong>Books & Resources</strong>
            <span>14 books by Jim &amp; Susan Wood — available at the WVR bookstore</span>
          </a>
        </section>

        {/* ── Episode archive CTA ──────────────────────────────────── */}
        <section className="public-band" style={{ justifyContent: "space-between" }}>
          <div>
            <p className="eyebrow">Episode Archive</p>
            <h2>Browse Abiding in Christ Episodes</h2>
            <p>
              Search the full corpus of episodes, scripture references, topics, and summaries.
            </p>
          </div>
          <Link className="button button--primary" href="/episodes">
            Browse Episodes →
          </Link>
        </section>

        {/* ── Affiliated ministries ────────────────────────────────── */}
        <section className="public-affiliates">
          <p className="eyebrow" style={{ textAlign: "center", marginBottom: 20 }}>Affiliated Ministries</p>
          <div className="affiliates-row">
            <a href="https://wvr.org/" target="_blank" rel="noopener" className="affiliate-card">
              <strong>Wears Valley Ranch</strong>
              <span>Christian homes, education &amp; counseling for children in crisis — Sevier County, TN</span>
            </a>
            <a href="http://www.cccwearsvalley.org/" target="_blank" rel="noopener" className="affiliate-card">
              <strong>Covenant Community Church</strong>
              <span>Wears Valley, Tennessee — Senior Pastor Jim Wood</span>
            </a>
            <a href="https://www.pastorwood.org/contact/" target="_blank" rel="noopener" className="affiliate-card">
              <strong>Speaking &amp; Contact</strong>
              <span>Book Pastor Wood for conferences, churches, and events</span>
            </a>
          </div>
        </section>

        {isAdministrator ? (
          <section className="public-band console-cta-band">
            <div>
              <p className="eyebrow">Administration</p>
              <h2>Administrative Health Dashboard</h2>
              <p>Review corpus coverage, Podtrac linkage, source traces, and pipeline status.</p>
            </div>
            <Link className="button button--ghost" href="/overview">
              Open dashboard →
            </Link>
          </section>
        ) : null}

      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="public-footer">
        <div className="public-footer__inner">
          <div className="footer-brand">
            <Image
              src="/images/pastor-wood.jpg"
              alt="Pastor Jim Wood"
              width={40}
              height={50}
              className="footer-portrait"
            />
            <div>
              <strong>Pastor Jim Wood</strong>
              <small>Abiding in Christ · pastorwood.org</small>
            </div>
          </div>
          <nav className="footer-links" aria-label="Footer links">
            <a href="https://www.pastorwood.org/about-pastor-wood/" target="_blank" rel="noopener">About</a>
            <a href="https://www.pastorwood.org/radio" target="_blank" rel="noopener">Radio</a>
            <a href="https://itunes.apple.com/us/podcast/abiding-in-christ-w-jim-wood/id375149712?mt=2" target="_blank" rel="noopener">Podcast</a>
            <a href="https://wvr.org/bookstore/" target="_blank" rel="noopener">Books</a>
            <a href="https://www.pastorwood.org/donate/" target="_blank" rel="noopener">Donate</a>
            <a href="https://www.pastorwood.org/contact/" target="_blank" rel="noopener">Contact</a>
          </nav>
          <p className="footer-copy">
            © {new Date().getFullYear()} Pastor Jim Wood Ministries ·{" "}
            <a href="https://www.pastorwood.org/privacy-terms-conditions/" target="_blank" rel="noopener">
              Privacy & Terms
            </a>
          </p>
        </div>
      </footer>
    </>
  );
}
