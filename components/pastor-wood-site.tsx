import Image from "next/image";
import Link from "next/link";

const GPT_URL = "https://chatgpt.com/g/g-6a3c3570a36481919368e6183e90ab12-pastor-wood";

const sourceLinks = [
  {
    title: "SermonAudio archive",
    eyebrow: "Original audio source",
    href: "https://www.sermonaudio.com/broadcasters/aic/sermons?media=audio&sort=newest",
    text: "Browse Abiding in Christ sermons at the source, including older SermonAudio messages.",
  },
  {
    title: "Apple Podcasts",
    eyebrow: "Podcast source",
    href: "https://podcasts.apple.com/us/podcast/abiding-in-christ-w-jim-wood/id1351579966",
    text: "Follow the Abiding in Christ podcast in Apple Podcasts for current episodes.",
  },
  {
    title: "Radio and broadcast listings",
    eyebrow: "Listen live",
    href: "https://www.pastorwood.org/radio/",
    text: "Find station information and radio times for Abiding in Christ broadcasts.",
  },
];

const resourceLinks = [
  {
    title: "Books and resources",
    href: "https://wvr.org/bookstore/",
    text: "Books and teaching resources connected with Pastor Wood and Wears Valley Ranch.",
  },
  {
    title: "Weekly devotional",
    href: "https://www.pastorwood.org/bible-study/",
    text: "Devotional posts and Bible-study material from the existing Pastor Wood ministry site.",
  },
  {
    title: "Written resources",
    href: "https://www.pastorwood.org/written-resources/",
    text: "Articles and written teaching resources intended for study and ministry use.",
  },
  {
    title: "Wears Valley Ranch",
    href: "https://wvr.org/",
    text: "Learn about the Christian children's home founded by Jim and Susan Wood.",
  },
];

export function PastorWoodSite() {
  return (
    <main className="pw-site">
      <header className="pw-nav" aria-label="Pastor Wood site navigation">
        <Link className="pw-brand" href="#top" aria-label="Pastor Wood home">
          <span className="pw-brand__mark">PW</span>
          <span>
            <strong>Pastor Wood</strong>
            <small>Abiding in Christ</small>
          </span>
        </Link>
        <nav className="pw-nav__links">
          <Link href="#about">About</Link>
          <Link href="#listen">Listen</Link>
          <Link href="#resources">Resources</Link>
          <Link href="#contact">Contact</Link>
        </nav>
        <Link className="pw-nav__cta" href={GPT_URL} target="_blank" rel="noreferrer">
          Ask the GPT
        </Link>
      </header>

      <section className="pw-hero" id="top">
        <div className="pw-hero__media" aria-hidden="true">
          <Image
            src="/images/mountain-study/valley-sunrise.png"
            alt=""
            width={1100}
            height={820}
            priority
          />
          <div className="pw-hero__portrait">
            <Image src="/images/pastor-wood.jpg" alt="Pastor Jim Wood" width={320} height={320} priority />
          </div>
        </div>
        <div className="pw-hero__copy">
          <p className="pw-eyebrow">Radio, books, conferences, preaching</p>
          <h1>Pastor Jim Wood teaching the Bible with clarity, conviction, and hope.</h1>
          <p className="pw-hero__lead">
            A public home for Abiding in Christ resources, Pastor Wood&apos;s biography, original-source audio links,
            and a connected GPT for sermon transcript research.
          </p>
          <div className="pw-actions">
            <Link className="pw-button pw-button--primary" href={GPT_URL} target="_blank" rel="noreferrer">
              Ask Pastor Wood GPT
            </Link>
            <Link className="pw-button pw-button--ghost" href="#listen">
              Listen from the source
            </Link>
          </div>
          <p className="pw-source-note">
            Audio is linked to original platforms. This site does not host or proxy sermon audio.
          </p>
        </div>
      </section>

      <section className="pw-strip" aria-label="Ministry highlights">
        <div>
          <strong>Montreat roots</strong>
          <span>Preaching since age fifteen</span>
        </div>
        <div>
          <strong>Abiding in Christ</strong>
          <span>Radio and podcast teaching</span>
        </div>
        <div>
          <strong>Wears Valley Ranch</strong>
          <span>Christian home for children</span>
        </div>
      </section>

      <section className="pw-section pw-about" id="about">
        <div>
          <p className="pw-eyebrow">About Pastor Wood</p>
          <h2>Faithful Bible exposition shaped by decades of ministry.</h2>
        </div>
        <div className="pw-about__body">
          <p>
            Jim Wood is the founder of Wears Valley Ranch. Growing up in Montreat, North Carolina, he began
            preaching as a teenager and has spent his life preaching and teaching Scripture.
          </p>
          <p>
            Pastor Wood&apos;s ministry includes Abiding in Christ radio broadcasts, books, conferences, and pastoral
            teaching intended to point listeners to the gospel and the authority of God&apos;s Word.
          </p>
          <div className="pw-about__links">
            <Link href="https://www.pastorwood.org/about-pastor-wood/" target="_blank" rel="noreferrer">
              Read the original bio
            </Link>
            <Link href="https://www.pastorwood.org/endorsements/" target="_blank" rel="noreferrer">
              View endorsements
            </Link>
            <Link href="https://www.pastorwood.org/board-members/" target="_blank" rel="noreferrer">
              Ministry board
            </Link>
          </div>
        </div>
      </section>

      <section className="pw-section" id="listen">
        <div className="pw-section__header">
          <p className="pw-eyebrow">Listen</p>
          <h2>Start with the original source.</h2>
          <p>
            Each audio path below sends visitors to the platform where the broadcast or sermon is already published.
          </p>
        </div>
        <div className="pw-card-grid pw-card-grid--three">
          {sourceLinks.map((item) => (
            <Link className="pw-card pw-card--source" href={item.href} target="_blank" rel="noreferrer" key={item.title}>
              <span>{item.eyebrow}</span>
              <strong>{item.title}</strong>
              <p>{item.text}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="pw-gpt-panel" id="gpt">
        <div>
          <p className="pw-eyebrow">New research tool</p>
          <h2>Ask questions across the Pastor Wood sermon transcript index.</h2>
          <p>
            The Pastor Wood GPT uses a connected retrieval API to search transcript excerpts and answer from
            indexed sermon material. Use it for Bible study, sermon research, and finding relevant teaching.
          </p>
        </div>
        <Link className="pw-button pw-button--dark" href={GPT_URL} target="_blank" rel="noreferrer">
          Open Pastor Wood GPT
        </Link>
      </section>

      <section className="pw-section" id="resources">
        <div className="pw-section__header">
          <p className="pw-eyebrow">Resources</p>
          <h2>Books, devotionals, ministry background, and written teaching.</h2>
        </div>
        <div className="pw-resource-list">
          {resourceLinks.map((item) => (
            <Link className="pw-resource" href={item.href} target="_blank" rel="noreferrer" key={item.title}>
              <span>{item.title}</span>
              <p>{item.text}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="pw-section pw-contact" id="contact">
        <div>
          <p className="pw-eyebrow">Contact and speaking</p>
          <h2>Reach the ministry team.</h2>
          <p>
            For feedback, prayer requests, speaking requests, or broadcast questions, use the ministry contact
            channels from the existing Pastor Wood site.
          </p>
        </div>
        <div className="pw-contact__panel">
          <p><strong>Toll free</strong> <a href="tel:18664122433">(866) 412-2433</a></p>
          <p><strong>Local</strong> <a href="tel:18654297101">(865) 429-7101</a></p>
          <p><strong>Email</strong> <a href="mailto:Radio@pastorwood.org">Radio@pastorwood.org</a></p>
          <p><strong>Mail</strong> 100 One Fine Place, Sevierville, TN 37862</p>
          <Link href="https://www.pastorwood.org/contact/" target="_blank" rel="noreferrer">
            Open contact page
          </Link>
        </div>
      </section>

      <footer className="pw-footer">
        <div>
          <strong>Pastor Wood</strong>
          <span>Abiding in Christ public resource site</span>
        </div>
        <nav>
          <Link href="https://www.pastorwood.org/donate/" target="_blank" rel="noreferrer">Donate</Link>
          <Link href="https://www.pastorwood.org/privacy-terms-conditions/" target="_blank" rel="noreferrer">Privacy</Link>
          <Link href="https://www.pastorwood.org/" target="_blank" rel="noreferrer">Legacy site</Link>
        </nav>
      </footer>
    </main>
  );
}
