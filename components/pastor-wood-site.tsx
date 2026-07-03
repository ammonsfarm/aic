import Image from "next/image";
import Link from "next/link";

import { getStrapiSiteSettings, type StrapiSiteSettings } from "@/lib/strapi-site-settings";

const originalSite = "https://www.pastorwood.org";

const routes = {
  home: "/",
  about: "/about-pastor-wood/",
  endorsements: "/endorsements/",
  board: "/board-members/",
  radio: "/radio/",
  devotional: "/bible-study/",
  written: "/written-resources/",
  contact: "/contact/",
  donate: "/donate/",
  donorDashboard: "/donor-dashboard/",
  privacy: "/privacy-terms-conditions/",
};

const navLinks = [
  { label: "Home", href: routes.home },
  { label: "About Us", href: routes.about },
  { label: "Radio", href: routes.radio },
  { label: "Endorsements", href: routes.endorsements },
  { label: "Contact", href: routes.contact },
];

const primaryLinks = [
  { label: "Pastor Jim Wood's Bio", href: routes.about },
  { label: "Books", href: "https://wvr.org/bookstore/" },
  { label: "Radio Broadcasts", href: routes.radio },
  { label: "Podcasts", href: "https://itunes.apple.com/us/podcast/abiding-in-christ-w-jim-wood/id375149712?mt=2" },
  { label: "Weekly Devotional", href: routes.devotional },
  { label: "Written Resources", href: routes.written },
  { label: "Speaking / Contact Us", href: routes.contact },
  { label: "Donate", href: routes.donate },
];

const footerAffiliateLinks = [
  { label: "Wears Valley Ranch", href: "https://wvr.org/" },
  { label: "Covenant Community Church", href: "http://www.cccwearsvalley.org/" },
  { label: "About Pastor Wood", href: routes.about },
  { label: "Board Members", href: routes.board },
  { label: "Privacy, Terms & Conditions", href: routes.privacy },
];

const footerResourceLinks = [
  { label: "Bible Study", href: routes.devotional },
  { label: "Radio Shows", href: routes.radio },
  { label: "Written Resources", href: routes.written },
  { label: "Speaking Request", href: routes.contact },
  { label: "Contact", href: routes.contact },
  { label: "Endorsements", href: routes.endorsements },
  { label: "RSS", href: `${originalSite}/feed/` },
];

function settingsLinks(items: StrapiSiteSettings["topNavigation"] | undefined, fallback: Array<{ label: string; href: string }>) {
  return items?.length ? items.map((item) => ({ label: item.label, href: item.href })) : fallback;
}

const homeEndorsements = [
  {
    name: "Franklin Graham",
    title: "President & CEO, Samaritan's Purse / Billy Graham Evangelistic Association",
    quote:
      "Christ in us is what gives us power to live in the world without compromise. I hope you'll read Three Questions. You'll be glad you did.",
  },
  {
    name: "Dr. Voddie Baucham, Jr.",
    title: "Voddie Baucham Ministries",
    quote:
      "If you are a fan of Jim Wood's radio program, you'll love Three Questions. With his usual insightful, biblical, accessible style, Jim takes the reader on a journey through three age-old questions that have eternal significance.",
  },
  {
    name: "Bryant Wright",
    title: "President, Send Relief / Right From the Heart Ministries",
    image: `${originalSite}/wp-content/uploads/2015/02/Bryant-Wright_hrzc.jpg`,
    quote:
      "When I'm reading a book on the Christian life, I'm often wondering, 'Does this guy really live what he says?' I assure you, when it comes to prayer, Jim Wood practices what he preaches.",
  },
  {
    name: "Randy Davis",
    title: "President & Executive Director, Tennessee Baptist Mission Board",
    quote:
      "Jim Wood is one of the most effective communicators I have heard in the last 25 years. He is solidly anchored to the word of God in the principles and precepts he teaches.",
  },
];

const additionalEndorsements = [
  {
    name: "Scott Sauls",
    title: "Senior Pastor, Christ Presbyterian Church: Nashville, TN",
    quote:
      "Jim Wood is a dynamic communicator that loves deeply the call of James 1:27, to care for widows and orphans in their distress.",
  },
  {
    name: "Mary Beth Chapman",
    title: "President, Show Hope",
    image: `${originalSite}/wp-content/uploads/2015/02/Chapmanbio.png`,
    quote:
      "When I heard Jim speak and spent time with him listening to his story, I was reminded again that God is woven into every fabric of our story, be it one of joy or pain.",
  },
  {
    name: "Dr. Billy and Ruth Graham",
    title: "Billy Graham Evangelistic Association",
    image: `${originalSite}/wp-content/uploads/2015/02/Dr_Billy_Ruth_Graham.jpg`,
    quote:
      "Wears Valley Ranch has helped to meet a desperate situation, and the caring couple, Jim and Susan Wood, bring normalcy, love and joy into many devastated young lives.",
  },
  {
    name: "Dr. Charles Swindoll",
    title: "Pastor, Living Ministries, Dallas Theological Seminary, and Stonebriar Community Church",
    quote:
      "Wears Valley Ranch is a noble ministry, nestled in one of the most beautiful and serene settings in the State of Tennessee.",
  },
  {
    name: "Joe Johnson",
    title: "President Emeritus, The University of Tennessee",
    quote: "Joe Johnson served among the additional endorsers for Pastor Wood and Abiding in Christ.",
  },
];

const boardMembers = [
  {
    name: "Bryant Wright",
    role: "Chairman",
    detail: "Founder, Right From the Heart Ministries; President, Send Relief; Past President, Southern Baptist Convention. Marietta, GA.",
    image: `${originalSite}/wp-content/uploads/2015/02/Bryant-Wright_hrzc.jpg`,
  },
  {
    name: "David Pattillo",
    role: "Treasurer",
    detail: "Director, Endava. Atlanta, GA.",
    image: `${originalSite}/wp-content/uploads/2015/02/David-Pattillo.png`,
  },
  {
    name: "Jan Donaldson",
    role: "Boardmember",
    detail: "Atlanta, GA.",
    image: `${originalSite}/wp-content/uploads/2024/03/Jan-1.jpeg`,
  },
  {
    name: "David White",
    role: "Boardmember",
    detail: "Douglasville, GA.",
    image: `${originalSite}/wp-content/uploads/2023/12/DavidWhite.png`,
  },
  {
    name: "Andrew Wood",
    role: "Head of School",
    detail: "St. Andrews School at Wears Valley Ranch. Maryville, TN.",
    image: `${originalSite}/wp-content/uploads/2023/12/AndrewWood.png`,
  },
  {
    name: "Jim Wood",
    role: "Founder, Wears Valley Ranch",
    detail: "Wears Valley, TN.",
    image: `${originalSite}/wp-content/uploads/2023/12/PsWood.png`,
  },
  {
    name: "James Wellman",
    role: "Emeritus",
    detail: "Atlanta, GA.",
    image: `${originalSite}/wp-content/uploads/2015/02/Wellman_org.jpg`,
  },
];

const radioEpisodes = [
  {
    title: "Covenant Community Church: Mark 16",
    path: "/radio/covenant-community-church-mark-16-2/",
    series: "CCC: Mark",
    passage: "Mark 16",
    date: "Program for 06/25/26",
    audio: `${originalSite}/wp-content/uploads/sermons/2026/06/aic_260625_bestof_ccc_Mark16.mp3`,
  },
  {
    title: "Covenant Community Church: Mark 15:1-39",
    path: "/radio/covenant-community-church-mark-151-39-2/",
    series: "CCC: Mark",
    passage: "Mark 15:1-39",
    date: "Program for 06/24/26",
    audio: `${originalSite}/wp-content/uploads/sermons/2026/06/06-24-26_bestof_ccc_Mark15_1-39.mp3`,
  },
  {
    title: "Covenant Community Church: Mark 14:27-72",
    path: "/radio/covenant-community-church-mark-1427-72-2/",
    series: "CCC: Mark",
    passage: "Mark 14:27-72",
    date: "Program for 06/23/26",
    audio: `${originalSite}/wp-content/uploads/sermons/2026/06/06-23-26_bestof_ccc_Mark14_vs_27-72.mp3`,
  },
  {
    title: "Covenant Community Church: Mark 14:12-26",
    path: "/radio/covenant-community-church-mark-1412-26-2/",
    series: "CCC: Mark",
    passage: "Mark 14:12-26",
    date: "Recent radio archive",
    audio: `${originalSite}/wp-content/uploads/sermons/2026/06/06-22-26_bestof_ccc_Mark14_vs_12-26.mp3`,
  },
  {
    title: "Covenant Community Church: Mark 14:1-11",
    path: "/radio/covenant-community-church-mark-141-11-2/",
    series: "CCC: Mark",
    passage: "Mark 14:1-11",
    date: "Recent radio archive",
    audio: `${originalSite}/wp-content/uploads/sermons/2026/06/06-19-26_bestof_ccc_Mark14_vs_1-11.mp3`,
  },
  {
    title: "Jim Wood: Interview with Dr. Seth Troutt, Authentic Masculinity",
    path: "/radio/jim-wood-interview-with-dr-seth-troutt-authentic-masculinity/",
    series: "Interview",
    passage: "",
    date: "Recent radio archive",
    audio: `${originalSite}/wp-content/uploads/sermons/2026/06/06-16-26_jimwood_sethtroutt.mp3`,
  },
];

const devotionalPosts = [
  {
    title: "Giving Thanks",
    date: "May 20, 2026",
    excerpt:
      "This coming Monday, our country will observe Memorial Day. For many people it is a time to cook and eat a lot of food. For some it merely provides a day off from work.",
    href: `${originalSite}/2026/05/giving-thanks/`,
  },
  {
    title: "Dining with Pharisees on the Sabbath - Luke 14 - Part 7, Conclusion",
    date: "May 13, 2026",
    excerpt:
      "From Dining with Jesus: Jesus also said to the one who had invited him, when you give a lunch or a dinner, do not invite only those who can repay you.",
    href: `${originalSite}/2026/05/dining-with-pharisees-on-the-sabbath-luke-14-part-7-conclusion/`,
  },
  {
    title: "Dining with Pharisees on the Sabbath - Luke 14 - Part 6",
    date: "May 6, 2026",
    excerpt:
      "From Dining with Jesus: Luke 14 continues with Christ's instruction about humility, generosity, and the kingdom of God.",
    href: `${originalSite}/2026/05/dining-with-pharisees-on-the-sabbath-luke-14-part-6/`,
  },
  {
    title: "Dining with Pharisees on the Sabbath - Luke 14 - Part 5",
    date: "April 29, 2026",
    excerpt:
      "One Sabbath, Jesus went to eat at the house of one of the leading Pharisees, and they were watching him closely.",
    href: `${originalSite}/2026/04/dining-with-pharisees-on-the-sabbath-luke-14-part-5/`,
  },
];

const writtenResources = [
  {
    title: "God's Gift",
    date: "December 20, 2023",
    excerpt:
      "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.",
    href: `${originalSite}/2023/12/gods-gift/`,
  },
  {
    title: "Abortion Bible Study",
    date: "December 11, 2023",
    excerpt:
      "A short personal Bible study on God as the giver of human life, beginning with the testimony of Scripture from conception onward.",
    href: `${originalSite}/2023/12/abortion-bible-study/`,
  },
  {
    title: "What Are You Afraid Of?",
    date: "December 9, 2023",
    excerpt:
      "If you know Jesus Christ as your Lord and Savior, you do not have to be afraid. Jesus taught whom we should truly fear.",
    href: `${originalSite}/2023/12/what-are-you-afraid-of/`,
  },
];

type PageKey = "about" | "endorsements" | "board" | "devotional" | "written" | "contact" | "donate" | "privacy" | "donorDashboard";

function isExternalHref(href: string) {
  return href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:");
}

function SmartLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  if (isExternalHref(href)) {
    return <a className={className} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>{children}</a>;
  }
  return <Link className={className} href={href}>{children}</Link>;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

function PersonPhoto({ name, image, compact = false }: { name: string; image?: string; compact?: boolean }) {
  return (
    <div className={compact ? "pw-person-photo pw-person-photo--compact" : "pw-person-photo"}>
      {image ? <img src={image} alt={name} /> : <span>{initials(name)}</span>}
    </div>
  );
}

function PastorWoodNav({ siteSettings }: { siteSettings?: StrapiSiteSettings | null }) {
  const links = settingsLinks(siteSettings?.topNavigation, navLinks);
  const donateLabel = siteSettings?.donateButtonLabel || "Donate";
  const donateHref = siteSettings?.donateButtonUrl || routes.donate;
  return (
    <header className="pw-nav" aria-label="Pastor Wood site navigation">
      <Link className="pw-brand pw-brand--wordmark" href={routes.home} aria-label="Pastor Wood home">
        <span className="pw-brand-wordmark" aria-hidden="true">
          <Image
            src="/images/pastorwood/deep-forest-wide-transparent-nav.webp"
            alt="Abiding in Christ"
            width={640}
            height={360}
            priority
          />
        </span>
      </Link>
      <nav className="pw-nav__links">
        {links.map((item) => <Link key={item.label} href={item.href}>{item.label}</Link>)}
      </nav>
      {siteSettings?.showDonateButton !== false ? <Link className="pw-nav__cta" href={donateHref}>{donateLabel}</Link> : null}
    </header>
  );
}

function PastorWoodFooter({ siteSettings }: { siteSettings?: StrapiSiteSettings | null }) {
  const footerLinks = settingsLinks(siteSettings?.footerNavigation, [...footerAffiliateLinks, ...footerResourceLinks]);
  const footerText = siteSettings?.footerText || "A Ministry of Jim Wood";
  return (
    <footer className="pw-footer">
      <div className="pw-footer__brand"><strong>{siteSettings?.siteName || "Pastor Jim Wood"}</strong><span>{footerText}</span>{siteSettings?.copyrightText ? <span>{siteSettings.copyrightText}</span> : null}</div>
      <div className="pw-footer__links" aria-label="Footer navigation">
        <strong>Links</strong>
        {footerLinks.map((item) => <SmartLink key={`${item.label}-${item.href}`} href={item.href}>{item.label}</SmartLink>)}
      </div>
    </footer>
  );
}

function PastorWoodShell({ children, siteSettings }: { children: React.ReactNode; siteSettings?: StrapiSiteSettings | null }) {
  return (
    <main className="pw-site">
      <PastorWoodNav siteSettings={siteSettings} />
      {children}
      <PastorWoodFooter siteSettings={siteSettings} />
    </main>
  );
}

function LinkBand({ siteSettings }: { siteSettings?: StrapiSiteSettings | null }) {
  const links = settingsLinks(siteSettings?.utilityNavigation, primaryLinks);
  return (
    <section className="pw-link-band" aria-label="Original Pastor Wood links">
      {links.map((item) => <SmartLink key={item.label} href={item.href}>{item.label}</SmartLink>)}
    </section>
  );
}

function EndorsementFigure({ item }: { item: { name: string; title: string; quote: string; image?: string } }) {
  return (
    <figure className="pw-endorsement">
      <PersonPhoto name={item.name} image={item.image} />
      <blockquote>{item.quote}</blockquote>
      <figcaption><strong>{item.name}</strong><span>{item.title}</span></figcaption>
    </figure>
  );
}

export async function PastorWoodSite() {
  const siteSettings = await getStrapiSiteSettings();

  return (
    <PastorWoodShell siteSettings={siteSettings}>
      <section className="pw-hero" id="top">
        <div className="pw-hero__image" aria-hidden="true">
          <Image src="/images/pastorwood/smoky-mountain-church.png" alt="" width={1792} height={1024} priority />
        </div>
        <div className="pw-hero__content">
          <p className="pw-kicker">Radio, Books, Conferences, Preaching</p>
          <h1>Welcome to Abiding in Christ</h1>
          <p className="pw-hero__lead">A ministry of Jim Wood.</p>
          <div className="pw-hero__actions">
            <Link className="pw-button pw-button--primary" href={routes.radio}>Listen to Abiding in Christ Radio</Link>
            <Link className="pw-button pw-button--light" href={routes.contact}>Speaking / Contact Us</Link>
          </div>
        </div>
      </section>

      <LinkBand siteSettings={siteSettings} />

      <section className="pw-section pw-bio" id="bio">
        <div className="pw-bio__portrait"><Image src="/images/pastor-wood.jpg" alt="Pastor Jim Wood" width={768} height={960} priority /></div>
        <div className="pw-bio__copy">
          <p className="pw-kicker">Brief Bio</p>
          <h2>About Pastor Wood</h2>
          <p>Pastor Jim Wood is passionate about sharing the gospel. He wrote his first sermon at nine, began preaching at fifteen and has been preaching and teaching the Bible, whenever possible, for over fifty years.</p>
          <p>Jim is the Founder of Wears Valley Ranch, a home and school for children from families in crisis. Jim also hosts a radio program, Abiding in Christ, which airs M-F on Sirius/XM Family Talk, Channel 131.</p>
          <p>He and his wife Susan have been married for 50 years and have 7 children and 15 grandchildren.</p>
          <div className="pw-inline-links"><Link href={routes.about}>About Pastor Wood</Link><a href="https://wvr.org/" target="_blank" rel="noreferrer">Wears Valley Ranch</a></div>
        </div>
      </section>

      <section className="pw-section pw-listen" id="listen">
        <div className="pw-section__intro">
          <p className="pw-kicker">Listen</p>
          <h2>Listen to Abiding in Christ Radio</h2>
          <p>Whether interviewing guests about current events or preaching directly from the Bible, Pastor Wood encourages his listeners to follow Jesus Christ in whole-hearted obedience.</p>
        </div>
        <div className="pw-listen__grid">
          <a className="pw-listen-card" href="https://itunes.apple.com/us/podcast/abiding-in-christ-w-jim-wood/id375149712?mt=2" target="_blank" rel="noreferrer"><strong>Podcast on iTunes</strong><span>Listen to Abiding in Christ Radio via iTunes.</span></a>
          <Link className="pw-listen-card" href={routes.radio}><strong>Radio Show Listings</strong><span>Find current Abiding in Christ radio broadcast information and listings.</span></Link>
          <a className="pw-listen-card" href="https://familytalktoday.com/programguidedaily/" target="_blank" rel="noreferrer"><strong>SiriusXM Family Talk 131</strong><span>M-F 8:30 PM ET / 5:30 PM PT.</span></a>
          <a className="pw-listen-card" href="https://www.facebook.com/PastorJimWood/" target="_blank" rel="noreferrer"><strong>Stay Connected</strong><span>Follow Pastor Jim Wood on Facebook.</span></a>
        </div>
      </section>

      <section className="pw-section pw-book">
        <div><p className="pw-kicker">Books / Resources</p><h2>Books</h2><p>Find Pastor Wood&apos;s books and related ministry resources through the Wears Valley Ranch bookstore.</p></div>
        <a className="pw-button pw-button--primary" href="https://wvr.org/bookstore/" target="_blank" rel="noreferrer">Visit Bookstore</a>
      </section>

      <section className="pw-section" id="endorsements">
        <div className="pw-section__intro"><p className="pw-kicker">Endorsements</p><h2>Endorsements for Pastor Wood and Abiding in Christ</h2></div>
        <div className="pw-endorsement-grid">{homeEndorsements.map((item) => <EndorsementFigure key={item.name} item={item} />)}</div>
        <Link className="pw-text-link" href={routes.endorsements}>More Endorsements</Link>
      </section>

      <ContactSection />
      <DevotionalSignup />
    </PastorWoodShell>
  );
}

function PageHero({ eyebrow, title, body }: { eyebrow?: string; title: string; body: string }) {
  return (
    <section className="pw-page-hero">
      {eyebrow ? <p className="pw-kicker">{eyebrow}</p> : null}
      <h1>{title}</h1>
      {body ? <p>{body}</p> : null}
    </section>
  );
}

function ContactSection() {
  return (
    <section className="pw-section pw-contact" id="contact">
      <div><p className="pw-kicker">Ministry Office</p><h2>Invite Pastor Wood to speak.</h2><p>For conferences, prayer requests, or ministry correspondence, use the phone, email, or mailing address here.</p></div>
      <div className="pw-contact__panel">
        <p><strong>Toll free</strong> <a href="tel:18664122433">(866) 41Abide / (866) 412-2433</a></p>
        <p><strong>Local</strong> <a href="tel:18654297101">(865) 429-7101</a></p>
        <p><strong>Email</strong> <a href="mailto:Radio@pastorwood.org">Radio@pastorwood.org</a></p>
        <p><strong>Mail</strong> 100 One Fine Place, Sevierville, TN 37862</p>
      </div>
    </section>
  );
}

function DevotionalSignup() {
  return (
    <section className="pw-section pw-devotional">
      <div><p className="pw-kicker">Subscribe To Our Weekly Devotional</p><h2>Join our mailing list to receive encouragement as you walk with Christ.</h2></div>
      <Link className="pw-button pw-button--light" href={routes.devotional}>Subscribe</Link>
    </section>
  );
}

function PostList({ posts }: { posts: Array<{ title: string; date: string; excerpt: string; href: string }> }) {
  return (
    <div className="pw-post-list">
      {posts.map((post) => (
        <article className="pw-post-row" key={post.href}>
          <time>{post.date}</time>
          <div><h2>{post.title}</h2><p>{post.excerpt}</p><a href={post.href} target="_blank" rel="noreferrer">Read More</a></div>
        </article>
      ))}
    </div>
  );
}

export type PastorWoodCmsSection = {
  component?: string;
  eyebrow?: string;
  heading?: string;
  body?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  imageSide?: "none" | "left" | "right" | "";
  imageDescription?: string;
  image?: {
    url: string;
    alternativeText?: string;
    name?: string;
  } | null;
};

export type PastorWoodCmsPage = {
  title?: string;
  heroLabel?: string;
  heroTitle?: string;
  heroBody?: string;
  sections?: PastorWoodCmsSection[];
};

function escapeCmsHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function legacyMarkdownToHtml(value: string) {
  return escapeCmsHtml(value)
    .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(?!\*)([\s\S]+?)\*/g, "<em>$1</em>")
    .replace(/\[u\]([\s\S]+?)\[\/u\]/g, "<u>$1</u>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join("");
}

function sanitizeCmsHtml(value: string) {
  const source = /<[a-z][\s\S]*>/i.test(value) ? value : legacyMarkdownToHtml(value);

  return source
    .replace(/<\/?(script|style|iframe|object|embed|form|input|button|textarea|select|option|meta|link)[^>]*>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/\son\w+=[^\s>]+/gi, "")
    .replace(/href="\s*javascript:[^"]*"/gi, 'href="#"')
    .replace(/href='\s*javascript:[^']*'/gi, "href='#'")
    .replace(/<(?!\/?(?:p|br|strong|b|em|i|u|ul|ol|li|h1|h2|h3|a)\b)[^>]*>/gi, "")
    .replace(/<a\s+/gi, '<a rel="noreferrer" ');
}

function RichTextContent({ value }: { value: string }) {
  return <div className="pw-rich-text" dangerouslySetInnerHTML={{ __html: sanitizeCmsHtml(value) }} />;
}

function CmsPageSections({ sections }: { sections?: PastorWoodCmsSection[] }) {
  const renderedSections = (sections ?? []).filter((section) => section.body || section.heading || section.buttonLabel);

  if (renderedSections.length === 0) {
    return null;
  }

  return (
    <section className="pw-section pw-cms-sections">
      {renderedSections.map((section) => {
        const isCta = section.component === "page-sections.cta-section";
        const isImageText = section.component === "page-sections.image-text-section";
        const imageFirst = isImageText && section.imageSide === "left";
        const copy = (
          <div>
            {section.eyebrow ? <p className="pw-kicker">{section.eyebrow}</p> : null}
            {section.heading ? <h2>{section.heading}</h2> : null}
            <RichTextContent value={section.body ?? ""} />
          </div>
        );
        const imageDescription = section.imageDescription || section.image?.alternativeText || section.image?.name || section.heading || "Pastor Wood ministry image";
        const image = isImageText && section.image ? (
          <img src={section.image.url} alt={imageDescription} title={imageDescription} />
        ) : null;

        return (
          <article className={isCta ? "pw-donate-panel" : isImageText ? `pw-image-text pw-image-text--${section.imageSide || "right"}` : "pw-story-section"} key={`${section.component}-${section.heading}-${section.eyebrow}`}>
            {imageFirst ? image : null}
            {copy}
            {!imageFirst ? image : null}
            {isCta && section.buttonLabel && section.buttonUrl ? (
              <a className="pw-button pw-button--primary" href={section.buttonUrl} target={section.buttonUrl.startsWith("http") ? "_blank" : undefined} rel={section.buttonUrl.startsWith("http") ? "noreferrer" : undefined}>{section.buttonLabel}</a>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

function AboutPage({ cmsPage }: { cmsPage?: PastorWoodCmsPage | null }) {
  const heroTitle = cmsPage?.heroTitle || "Jim Wood";
  const heroBody = cmsPage?.heroBody || "Founder of Wears Valley Ranch, pastor, author, and host of Abiding in Christ.";
  const textSections = (cmsPage?.sections ?? []).filter((section) => (section.component === "page-sections.text-section" || section.component === "page-sections.image-text-section") && section.body);

  return (
    <>
      <PageHero eyebrow="Life and Ministry" title={heroTitle} body={heroBody} />
      <section className="pw-section pw-story">
        <div className="pw-story__copy">
          {textSections.length > 0 ? (
            <CmsPageSections sections={textSections} />
          ) : (
            <>
              <p>Jim Wood is the Founder of Wears Valley Ranch. Growing up in Montreat, North Carolina, Jim began preaching at age fifteen. After graduating from Gordon College in Massachusetts, Jim married Susan McDonald of Shreveport, Louisiana.</p>
              <p>They began married life at French Camp Academy in Mississippi, where they were house parents and teachers for two years. From French Camp, Jim returned to New England and attended Gordon-Conwell Theological Seminary where he earned an M.A. in Church History.</p>
              <p>After pastoring in New England for five years, Jim was called as senior pastor of Mount Vernon Baptist Church in Sandy Springs, Georgia. He served there for six years. During that time he helped develop relationships among pastors of various denominations who covenanted to pray for one another, encourage one another, and hold one another accountable.</p>
              <p>In 1991, Jim, Susan and their three sons left Mount Vernon to fulfill a vision for which they had prayed for over twenty years. In the Great Smoky Mountains in Tennessee, they established Wears Valley Ranch to provide Christian homes, education, and counseling for children from difficult family situations.</p>
              <p>Having served as Executive Director of Wears Valley Ranch for nearly 30 years, Jim retired from this capacity in December 2020. He remains as the Ranch&apos;s Founder, continuing his ministry of teaching and preaching at the Ranch, on radio and elsewhere.</p>
              <p>Jim&apos;s radio program, Abiding in Christ, airs weekdays on SiriusXM 131 satellite radio and is available on podcast. He and his wife, Susan, have authored 14 books and often lead seminars on marriage and parenting.</p>
            </>
          )}
        </div>
        {textSections.length > 0 ? null : (
          <div className="pw-story__images">
            <img src={`${originalSite}/wp-content/uploads/2019/02/Jim-and-Susan-2018-10_5-300x240.jpg`} alt="Pastor Jim and Mrs. Susan Wood" />
            <img src={`${originalSite}/wp-content/uploads/2015/02/jimwoodfamily2013Christmas.jpg`} alt="Pastor Wood and Family" />
          </div>
        )}
      </section>
    </>
  );
}

function EndorsementsPage({ cmsPage }: { cmsPage?: PastorWoodCmsPage | null }) {
  const heroTitle = cmsPage?.heroTitle || "Additional Endorsements for Pastor Wood";
  const heroBody = cmsPage?.heroBody || "Public endorsements from ministry leaders and friends of the work.";
  return (
    <>
      <PageHero eyebrow="Endorsements" title={heroTitle} body={heroBody} />
      <section className="pw-section"><div className="pw-endorsement-grid">{[...homeEndorsements, ...additionalEndorsements].map((item) => <EndorsementFigure key={item.name} item={item} />)}</div></section>
    </>
  );
}

function BoardPage({ cmsPage }: { cmsPage?: PastorWoodCmsPage | null }) {
  const heroTitle = cmsPage?.heroTitle || "Abiding in Christ Board Members";
  const heroBody = cmsPage?.heroBody || "We are fortunate to have the following people serving on our board.";
  return (
    <>
      <PageHero eyebrow="Board" title={heroTitle} body={heroBody} />
      <section className="pw-section"><div className="pw-board-grid">{boardMembers.map((member) => <article className="pw-board-member" key={member.name}><PersonPhoto name={member.name} image={member.image} compact /><div><h2>{member.name}</h2><p className="pw-board-role">{member.role}</p><p>{member.detail}</p></div></article>)}</div></section>
    </>
  );
}

function DevotionalPage({ cmsPage }: { cmsPage?: PastorWoodCmsPage | null }) {
  const heroTitle = cmsPage?.heroTitle || "Weekly Devotional";
  const heroBody = cmsPage?.heroBody || "Recent devotional posts from Pastor Wood. Full post pages remain on the original Pastor Wood site for now.";
  return (
    <>
      <PageHero eyebrow="Weekly Devotional" title={heroTitle} body={heroBody} />
      <section className="pw-section"><PostList posts={devotionalPosts} /></section>
      <DevotionalSignup />
    </>
  );
}

function WrittenResourcesPage({ cmsPage }: { cmsPage?: PastorWoodCmsPage | null }) {
  const heroTitle = cmsPage?.heroTitle || "Written Resources from Pastor Jim Wood";
  const heroBody = cmsPage?.heroBody || "Here are resources that we hope will bless you.";
  return (
    <>
      <PageHero eyebrow="Written Resources" title={heroTitle} body={heroBody} />
      <section className="pw-section"><PostList posts={writtenResources} /></section>
    </>
  );
}

function ContactPage({ cmsPage }: { cmsPage?: PastorWoodCmsPage | null }) {
  const heroTitle = cmsPage?.heroTitle || "Get in touch";
  const heroBody = cmsPage?.heroBody || "Feedback, prayer requests, and speaking invitations are welcome.";

  return (
    <>
      <PageHero eyebrow="Reach Us" title={heroTitle} body={heroBody} />
      {cmsPage?.sections?.length ? <CmsPageSections sections={cmsPage.sections} /> : <ContactSection />}
    </>
  );
}

function DonatePage({ cmsPage, donorDashboard = false }: { cmsPage?: PastorWoodCmsPage | null; donorDashboard?: boolean }) {
  const heroTitle = cmsPage?.heroTitle || (donorDashboard ? "Donor Dashboard" : "Donate Today");
  const heroBody = cmsPage?.heroBody || "Donation processing and donor account access remain on the original Pastor Wood site for now.";
  return (
    <>
      <PageHero eyebrow="Donate" title={heroTitle} body={heroBody} />
      {cmsPage?.sections?.length ? (
        <CmsPageSections sections={cmsPage.sections} />
      ) : (
        <section className="pw-section pw-donate-panel">
          <div><h2>{donorDashboard ? "Access your donor dashboard" : "Support Abiding in Christ"}</h2><p>{donorDashboard ? "Use the original donor dashboard for account access and giving history." : "Use the original secure giving page to support Pastor Wood and Abiding in Christ."}</p></div>
          <a className="pw-button pw-button--primary" href={donorDashboard ? `${originalSite}/donor-dashboard/` : `${originalSite}/donate/`} target="_blank" rel="noreferrer">Open on pastorwood.org</a>
        </section>
      )}
    </>
  );
}

function PrivacyPage({ cmsPage }: { cmsPage?: PastorWoodCmsPage | null }) {
  const heroTitle = cmsPage?.heroTitle || "Privacy, Terms & Conditions";
  const heroBody = cmsPage?.heroBody || "The original privacy, terms, and conditions page remains the current policy source.";
  return (
    <>
      <PageHero eyebrow="Privacy" title={heroTitle} body={heroBody} />
      {cmsPage?.sections?.length ? <CmsPageSections sections={cmsPage.sections} /> : <section className="pw-section pw-donate-panel"><div><h2>Current policy source</h2><p>Open the original Pastor Wood policy page for the current privacy, terms, and conditions content.</p></div><a className="pw-button pw-button--primary" href={`${originalSite}/privacy-terms-conditions/`} target="_blank" rel="noreferrer">Open Policy</a></section>}
    </>
  );
}

export async function PastorWoodGenericCmsPage({ cmsPage }: { cmsPage: PastorWoodCmsPage }) {
  const siteSettings = await getStrapiSiteSettings();
  const heroLabel = cmsPage.heroLabel || "";
  const heroTitle = cmsPage.heroTitle || cmsPage.title || "Page";
  const heroBody = cmsPage.heroBody || "";

  return (
    <PastorWoodShell siteSettings={siteSettings}>
      <PageHero eyebrow={heroLabel} title={heroTitle} body={heroBody} />
      <CmsPageSections sections={cmsPage.sections} />
    </PastorWoodShell>
  );
}

export async function PastorWoodContentPage({ page, cmsPage }: { page: PageKey; cmsPage?: PastorWoodCmsPage | null }) {
  const siteSettings = await getStrapiSiteSettings();
  const content = {
    about: <AboutPage cmsPage={cmsPage} />,
    endorsements: <EndorsementsPage cmsPage={cmsPage} />,
    board: <BoardPage cmsPage={cmsPage} />,
    devotional: <DevotionalPage cmsPage={cmsPage} />,
    written: <WrittenResourcesPage cmsPage={cmsPage} />,
    contact: <ContactPage cmsPage={cmsPage} />,
    donate: <DonatePage cmsPage={cmsPage} />,
    donorDashboard: <DonatePage cmsPage={cmsPage} donorDashboard />,
    privacy: <PrivacyPage cmsPage={cmsPage} />,
  }[page];

  return <PastorWoodShell siteSettings={siteSettings}>{content}</PastorWoodShell>;
}

function EpisodeCard({ episode }: { episode: (typeof radioEpisodes)[number] }) {
  return (
    <article className="pw-audio-card">
      <div className="pw-audio-card__meta"><span>{episode.date}</span><span>{episode.series}</span>{episode.passage ? <span>{episode.passage}</span> : null}</div>
      <h2><Link href={episode.path}>{episode.title}</Link></h2>
      <audio controls preload="none" src={episode.audio} />
      <a href={`${originalSite}${episode.path}`} target="_blank" rel="noreferrer">Open original episode page</a>
    </article>
  );
}

export async function PastorWoodRadioPage({ slug = [] }: { slug?: string[] }) {
  const siteSettings = await getStrapiSiteSettings();
  const normalized = slug.length ? `/radio/${slug.join("/")}/` : "/radio/";
  const episode = radioEpisodes.find((item) => item.path === normalized);

  if (slug.length && episode) {
    return (
      <PastorWoodShell siteSettings={siteSettings}>
        <PageHero eyebrow="Radio Archive" title={episode.title} body="Audio is loaded from the original Pastor Wood media library while the new archive is being built." />
        <section className="pw-section"><EpisodeCard episode={episode} /></section>
      </PastorWoodShell>
    );
  }

  if (slug.length) {
    const originalUrl = `${originalSite}/radio/${slug.join("/")}/`;
    return (
      <PastorWoodShell siteSettings={siteSettings}>
        <PageHero eyebrow="Radio Archive" title="Original radio archive item" body="This archive item has not been rebuilt on the new site yet. Use the original Pastor Wood page for the media player and full metadata." />
        <section className="pw-section pw-donate-panel"><div><h2>Open original media page</h2><p>The full Pastor Wood archive is still hosted on pastorwood.org.</p></div><a className="pw-button pw-button--primary" href={originalUrl} target="_blank" rel="noreferrer">Open on pastorwood.org</a></section>
      </PastorWoodShell>
    );
  }

  return (
    <PastorWoodShell siteSettings={siteSettings}>
      <PageHero eyebrow="Radio Locations / Times" title="Radio Show Listings" body="Listen to recent Abiding in Christ broadcasts. Media files currently stream from pastorwood.org." />
      <section className="pw-section pw-radio-layout">
        <div className="pw-radio-intro">
          <h2>Listen to radio shows</h2>
          <p>Whether interviewing guests about current events or preaching directly from the Bible, Pastor Wood encourages listeners to follow Jesus Christ in whole-hearted obedience.</p>
          <a className="pw-button pw-button--light" href="https://itunes.apple.com/us/podcast/abiding-in-christ-w-jim-wood/id375149712?mt=2" target="_blank" rel="noreferrer">Podcast on iTunes</a>
        </div>
        <div className="pw-audio-list">{radioEpisodes.map((episode) => <EpisodeCard key={episode.path} episode={episode} />)}</div>
      </section>
    </PastorWoodShell>
  );
}
