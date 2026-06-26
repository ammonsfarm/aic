import Image from "next/image";
import Link from "next/link";

const originalSite = "https://www.pastorwood.org";

const navLinks = [
  { label: "Home", href: "#top" },
  { label: "About Us", href: "#bio" },
  { label: "Radio", href: "#listen" },
  { label: "Endorsements", href: "#endorsements" },
  { label: "Contact", href: "#contact" },
];

const primaryLinks = [
  { label: "Pastor Jim Wood's Bio", href: `${originalSite}/about-pastor-wood/` },
  { label: "Books", href: "https://wvr.org/bookstore/" },
  { label: "Radio Broadcasts", href: `${originalSite}/radio` },
  { label: "Podcasts", href: "https://itunes.apple.com/us/podcast/abiding-in-christ-w-jim-wood/id375149712?mt=2" },
  { label: "Weekly Devotional", href: `${originalSite}/bible-study/` },
  { label: "Written Resources", href: `${originalSite}/written-resources/` },
  { label: "Speaking / Contact Us", href: `${originalSite}/contact/` },
  { label: "Donate", href: `${originalSite}/donate/` },
];

const listenLinks = [
  {
    title: "Podcast on iTunes",
    href: "https://itunes.apple.com/us/podcast/abiding-in-christ-w-jim-wood/id375149712?mt=2",
    text: "Listen to Abiding in Christ Radio via iTunes.",
  },
  {
    title: "Radio Show Listings",
    href: `${originalSite}/radio`,
    text: "Find current Abiding in Christ radio broadcast information and listings.",
  },
  {
    title: "SiriusXM Family Talk 131",
    href: `${originalSite}/radio`,
    text: "Monday through Friday at 8:30 PM EST on Salem Media's SiriusXM Family Talk, Channel 131.",
  },
  {
    title: "Stay Connected",
    href: "https://www.facebook.com/PastorJimWood/",
    text: "Follow Pastor Jim Wood on Facebook.",
  },
];

const endorsements = [
  {
    quote:
      "Christ in us is what gives us power to live in the world without compromise. I hope you'll read Three Questions. You'll be glad you did.",
    name: "Franklin Graham",
    role: "President & CEO, Samaritan's Purse / Billy Graham Evangelistic Association",
  },
  {
    quote:
      "If you are a fan of Jim Wood's radio program, you'll love Three Questions. With his usual insightful, biblical, accessible style, Jim takes the reader on a journey through three age-old questions that have eternal significance.",
    name: "Dr. Voddie Baucham, Jr.",
    role: "Voddie Baucham Ministries",
  },
  {
    quote:
      "When I'm reading a book on the Christian life, I'm often wondering, 'Does this guy really live what he says?' I assure you, when it comes to prayer, Jim Wood practices what he preaches.",
    name: "Bryant Wright",
    role: "President, Send Relief / Right From the Heart Ministries",
  },
  {
    quote:
      "Jim Wood is one of the most effective communicators I have heard in the last 25 years. He is solidly anchored to the word of God in the principles and precepts he teaches.",
    name: "Randy Davis",
    role: "President & Executive Director, Tennessee Baptist Mission Board",
  },
];

const affiliateLinks = [
  { label: "Wears Valley Ranch", href: "https://wvr.org/" },
  { label: "Covenant Community Church", href: "http://www.cccwearsvalley.org/" },
  { label: "Board Members", href: `${originalSite}/board-members/` },
  { label: "Privacy, Terms & Conditions", href: `${originalSite}/privacy-terms-conditions/` },
];

const resourceLinks = [
  { label: "Bible Study", href: `${originalSite}/?attachment_id=1228` },
  { label: "Radio Shows", href: `${originalSite}/radio` },
  { label: "Speaking Request", href: `${originalSite}/contact/` },
  { label: "Contact", href: `${originalSite}/contact/` },
  { label: "Endorsements", href: `${originalSite}/endorsements/` },
  { label: "RSS", href: `${originalSite}/feed/` },
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
          {navLinks.map((item) => (
            <Link href={item.href} key={item.label}>{item.label}</Link>
          ))}
        </nav>
        <Link className="pw-nav__cta" href={`${originalSite}/donate/`} target="_blank" rel="noreferrer">
          Donate
        </Link>
      </header>

      <section className="pw-hero" id="top">
        <div className="pw-hero__image" aria-hidden="true">
          <Image
            src="/images/pastorwood/smoky-mountain-church.png"
            alt=""
            width={1792}
            height={1024}
            priority
          />
        </div>
        <div className="pw-hero__content">
          <p className="pw-kicker">Radio, Books, Conferences, Preaching</p>
          <h1>Welcome to Abiding in Christ</h1>
          <p className="pw-hero__lead">A ministry of Jim Wood.</p>
          <div className="pw-hero__actions">
            <Link className="pw-button pw-button--primary" href="#listen">Listen to Abiding in Christ Radio</Link>
            <Link className="pw-button pw-button--light" href={`${originalSite}/contact/`} target="_blank" rel="noreferrer">
              Speaking / Contact Us
            </Link>
          </div>
        </div>
      </section>

      <section className="pw-link-band" aria-label="Original Pastor Wood links">
        {primaryLinks.map((item) => (
          <Link href={item.href} target="_blank" rel="noreferrer" key={item.label}>{item.label}</Link>
        ))}
      </section>

      <section className="pw-section pw-bio" id="bio">
        <div className="pw-bio__portrait">
          <Image src="/images/pastor-wood.jpg" alt="Pastor Jim Wood" width={768} height={960} priority />
        </div>
        <div className="pw-bio__copy">
          <p className="pw-kicker">Brief Bio</p>
          <h2>About Pastor Wood</h2>
          <p>
            Jim Wood grew up in Montreat, North Carolina, home of the Billy Graham Evangelistic Association.
            He began preaching as a teenager and has spent his life preaching and teaching Scripture.
          </p>
          <p>
            Pastor Wood&apos;s ministry includes Abiding in Christ radio broadcasts, books, conferences, and pastoral
            teaching intended to encourage listeners to follow Jesus Christ in whole-hearted obedience.
          </p>
          <p>
            Jim and Susan Wood founded Wears Valley Ranch, a home and school for children from families in crisis.
          </p>
          <div className="pw-inline-links">
            <Link href={`${originalSite}/about-pastor-wood/`} target="_blank" rel="noreferrer">About Pastor Wood</Link>
            <Link href="https://wvr.org/" target="_blank" rel="noreferrer">Wears Valley Ranch</Link>
          </div>
        </div>
      </section>

      <section className="pw-section pw-listen" id="listen">
        <div className="pw-section__intro">
          <p className="pw-kicker">Listen</p>
          <h2>Listen to Abiding in Christ Radio</h2>
          <p>
            Whether interviewing guests about current events or preaching directly from the Bible, Pastor Wood
            encourages his listeners to follow Jesus Christ in whole-hearted obedience.
          </p>
        </div>
        <div className="pw-listen__grid">
          {listenLinks.map((item) => (
            <Link className="pw-listen-card" href={item.href} target="_blank" rel="noreferrer" key={item.title}>
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="pw-section pw-book">
        <div>
          <p className="pw-kicker">Featured book</p>
          <h2>Three Questions</h2>
          <p>
            Endorsements on the current Pastor Wood site commend Three Questions for its clear focus on the gospel,
            the Christian life, prayer, and obedience to Christ.
          </p>
        </div>
        <Link className="pw-button pw-button--primary" href={`${originalSite}/resources/three-questions-jim-wood/`} target="_blank" rel="noreferrer">
          Read about Three Questions
        </Link>
      </section>

      <section className="pw-section" id="endorsements">
        <div className="pw-section__intro">
          <p className="pw-kicker">Endorsements</p>
          <h2>What ministry leaders have said</h2>
        </div>
        <div className="pw-endorsement-grid">
          {endorsements.map((item) => (
            <figure className="pw-endorsement" key={item.name}>
              <blockquote>{item.quote}</blockquote>
              <figcaption>
                <strong>{item.name}</strong>
                <span>{item.role}</span>
              </figcaption>
            </figure>
          ))}
        </div>
        <Link className="pw-text-link" href={`${originalSite}/endorsements/`} target="_blank" rel="noreferrer">
          More Endorsements
        </Link>
      </section>

      <section className="pw-section pw-contact" id="contact">
        <div>
          <p className="pw-kicker">Contact Pastor Wood</p>
          <h2>Hear Pastor Wood in person.</h2>
          <p>Contact today for your next conference or other speaking engagement.</p>
        </div>
        <div className="pw-contact__panel">
          <p><strong>Toll free</strong> <a href="tel:18664122433">(866) 412-2433</a></p>
          <p><strong>Local</strong> <a href="tel:18654297101">(865) 429-7101</a></p>
          <p><strong>Email</strong> <a href="mailto:Radio@pastorwood.org">Radio@pastorwood.org</a></p>
          <p><strong>Mail</strong> 100 One Fine Place, Sevierville, TN 37862</p>
          <Link href={`${originalSite}/contact/`} target="_blank" rel="noreferrer">Contact</Link>
        </div>
      </section>

      <section className="pw-section pw-devotional">
        <div>
          <p className="pw-kicker">Subscribe To Our Weekly Devotional</p>
          <h2>Join our mailing list to receive encouragment as you walk with Christ.</h2>
        </div>
        <Link className="pw-button pw-button--light" href={`${originalSite}/bible-study/`} target="_blank" rel="noreferrer">
          Subscribe
        </Link>
      </section>

      <footer className="pw-footer">
        <div className="pw-footer__brand">
          <strong>Pastor Jim Wood</strong>
          <span>A Ministry of Jim Wood</span>
        </div>
        <div className="pw-footer__links" aria-label="Affiliated Sites">
          <strong>Affiliated Sites</strong>
          {affiliateLinks.map((item) => (
            <Link href={item.href} target="_blank" rel="noreferrer" key={item.label}>{item.label}</Link>
          ))}
        </div>
        <div className="pw-footer__links" aria-label="Resources">
          <strong>Resources</strong>
          {resourceLinks.map((item) => (
            <Link href={item.href} target="_blank" rel="noreferrer" key={item.label}>{item.label}</Link>
          ))}
        </div>
      </footer>
    </main>
  );
}
