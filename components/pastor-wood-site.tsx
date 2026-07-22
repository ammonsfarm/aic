import Image from "next/image";
import Link from "next/link";

import { DevotionalSignupForm } from "@/components/devotional-signup-form";
import { getPublicDonationUrl } from "@/lib/public-donation";
import { listPublishedEndorsements, type PublishedEndorsement } from "@/lib/strapi-structured-public";
import { getStrapiSiteSettings, type StrapiSiteSettings } from "@/lib/strapi-site-settings";
import { safeCmsHref, sanitizeCmsHtml } from "@/lib/cms-html";

const originalSite = "https://www.pastorwood.org";

const routes = {
  home: "/",
  about: "/about-pastor-wood/",
  abiding: "/abiding-in-christ/",
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
  { label: "Podcasts", href: "https://podcasts.apple.com/us/podcast/abiding-in-christ-w-jim-wood/id375149712" },
  { label: "Weekly Devotional", href: routes.devotional },
  { label: "Written Resources", href: routes.written },
  { label: "Speaking / Contact Us", href: routes.contact },
  { label: "Donate", href: routes.donate },
];

const footerAffiliateLinks = [
  { label: "Wears Valley Ranch", href: "https://wvr.org/" },
  { label: "Covenant Community Church", href: "https://www.cccwearsvalley.org/" },
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
];

function settingsLinks(items: StrapiSiteSettings["topNavigation"] | undefined, fallback: Array<{ label: string; href: string }>) {
  const source = items?.length ? items : fallback;
  return source.flatMap((item) => {
    const href = safeCmsHref(item.href);
    return item.label.trim() && href ? [{ label: item.label.trim(), href }] : [];
  });
}

type PageKey = "about" | "abiding" | "endorsements" | "board" | "devotional" | "written" | "contact" | "donate" | "privacy" | "donorDashboard";

function SmartLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const safeHref = safeCmsHref(href);
  if (!safeHref) return null;
  if (safeHref.startsWith("https://") || safeHref.startsWith("mailto:") || safeHref.startsWith("tel:")) {
    return <a className={className} href={safeHref} target={safeHref.startsWith("https://") ? "_blank" : undefined} rel="noreferrer noopener">{children}</a>;
  }
  return <Link className={className} href={safeHref}>{children}</Link>;
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
  const requestedDonateHref = safeCmsHref(siteSettings?.donateButtonUrl || "");
  const donateHref = requestedDonateHref.startsWith("/") ? requestedDonateHref : getPublicDonationUrl(requestedDonateHref) || routes.donate;
  return (
    <header className="pw-nav">
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
      <nav className="pw-nav__links" aria-label="Primary navigation">
        {links.map((item) => <SmartLink key={item.label} href={item.href}>{item.label}</SmartLink>)}
      </nav>
      <details className="pw-mobile-nav">
        <summary>Menu</summary>
        <nav aria-label="Mobile navigation">
          {links.map((item) => <SmartLink key={item.label} href={item.href}>{item.label}</SmartLink>)}
        </nav>
      </details>
      {siteSettings?.showDonateButton !== false ? <SmartLink className="pw-nav__cta" href={donateHref}>{donateLabel}</SmartLink> : null}
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

export function PastorWoodShell({ children, siteSettings }: { children: React.ReactNode; siteSettings?: StrapiSiteSettings | null }) {
  return (
    <div className="pw-site">
      <a className="pw-skip-link" href="#main-content">Skip to main content</a>
      <PastorWoodNav siteSettings={siteSettings} />
      <main id="main-content" tabIndex={-1}>{children}</main>
      <PastorWoodFooter siteSettings={siteSettings} />
    </div>
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

function PastorWoodHome({
  siteSettings,
  endorsements = [],
  cmsPage,
}: {
  siteSettings?: StrapiSiteSettings | null;
  endorsements?: PublishedEndorsement[];
  cmsPage?: PastorWoodCmsPage | null;
}) {
  return (
    <PastorWoodShell siteSettings={siteSettings}>
      <section className="pw-hero" id="top">
        <div className="pw-hero__image" aria-hidden="true">
          <Image src="/images/pastorwood/smoky-mountain-church.png" alt="" width={1792} height={1024} priority />
        </div>
        <div className="pw-hero__content">
          <p className="pw-kicker">{cmsPage?.heroLabel || "Radio, Books, Conferences, Preaching"}</p>
          <h1>{cmsPage?.heroTitle || "Welcome to Abiding in Christ"}</h1>
          <p className="pw-hero__lead">{cmsPage?.heroBody || "A ministry of Jim Wood."}</p>
          <div className="pw-hero__actions">
            <Link className="pw-button pw-button--primary" href={routes.radio}>Listen to Abiding in Christ Radio</Link>
            <Link className="pw-button pw-button--light" href={routes.contact}>Speaking / Contact Us</Link>
          </div>
        </div>
      </section>

      <LinkBand siteSettings={siteSettings} />

      {cmsPage ? (
        cmsPage.sections?.length ? (
          <CmsPageSections sections={cmsPage.sections} />
        ) : (
          <section className="pw-section pw-content-unavailable" role="status">
            <h2>More ministry information is coming soon.</h2>
            <p>Listen to current broadcasts or contact the ministry using the links on this page.</p>
          </section>
        )
      ) : (
        <>
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
              <a className="pw-listen-card" href="https://podcasts.apple.com/us/podcast/abiding-in-christ-w-jim-wood/id375149712" target="_blank" rel="noreferrer"><strong>Apple Podcasts</strong><span>Listen to Abiding in Christ Radio on Apple Podcasts.</span></a>
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
            {endorsements.length ? (
              <div className="pw-endorsement-grid">
                {endorsements.slice(0, 4).map((item) => (
                  <EndorsementFigure key={item.documentId} item={{ name: item.attribution, title: [item.title, item.organization].filter(Boolean).join(", "), quote: item.quote, image: item.photoUrl }} />
                ))}
              </div>
            ) : <p className="pw-content-unavailable" role="status">Endorsements are temporarily unavailable while the content service reconnects.</p>}
            <Link className="pw-text-link" href={routes.endorsements}>More Endorsements</Link>
          </section>
        </>
      )}

      <ContactSection />
      <DevotionalSignup />
    </PastorWoodShell>
  );
}

export async function PastorWoodSite({ cmsPage }: { cmsPage?: PastorWoodCmsPage | null } = {}) {
  const [siteSettings, endorsements] = await Promise.all([
    getStrapiSiteSettings(),
    listPublishedEndorsements(),
  ]);
  return <PastorWoodHome siteSettings={siteSettings} endorsements={endorsements.filter((item) => item.featured)} cmsPage={cmsPage} />;
}

export function PastorWoodSitePreview({ siteSettings }: { siteSettings: StrapiSiteSettings }) {
  return <PastorWoodHome siteSettings={siteSettings} />;
}

export function PageHero({ eyebrow, title, body }: { eyebrow?: string; title: string; body: string }) {
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
      <DevotionalSignupForm sourcePath="/" />
    </section>
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
  seoTitle?: string;
  seoDescription?: string;
  sections?: PastorWoodCmsSection[];
};

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
        const buttonHref = safeCmsHref(section.buttonUrl ?? "");
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
            {isCta && section.buttonLabel && buttonHref ? (
              <a className="pw-button pw-button--primary" href={buttonHref} target={buttonHref.startsWith("http") ? "_blank" : undefined} rel={buttonHref.startsWith("http") ? "noreferrer noopener" : undefined}>{section.buttonLabel}</a>
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
            <Image src="/images/pastor-wood.jpg" alt="Pastor Jim Wood" width={768} height={960} />
          </div>
        )}
      </section>
    </>
  );
}

function AbidingInChristPage({ cmsPage }: { cmsPage?: PastorWoodCmsPage | null }) {
  const heroTitle = cmsPage?.heroTitle || "Abiding in Christ";
  const heroBody = cmsPage?.heroBody || "Bible teaching and conversations intended to encourage whole-hearted obedience to Jesus Christ.";

  return (
    <>
      <PageHero eyebrow={cmsPage?.heroLabel || "Radio Ministry"} title={heroTitle} body={heroBody} />
      {cmsPage?.sections?.length ? (
        <CmsPageSections sections={cmsPage.sections} />
      ) : (
        <section className="pw-section pw-story-section">
          <div>
            <h2>Listen to Abiding in Christ</h2>
            <p>Browse the public radio archive for recent programs, Bible teaching, and interviews from Jim Wood.</p>
            <div className="pw-inline-links"><Link href={routes.radio}>Browse radio programs</Link></div>
          </div>
        </section>
      )}
    </>
  );
}

function EndorsementsPage({ cmsPage }: { cmsPage?: PastorWoodCmsPage | null }) {
  const heroTitle = cmsPage?.heroTitle || "Additional Endorsements for Pastor Wood";
  const heroBody = cmsPage?.heroBody || "Public endorsements from ministry leaders and friends of the work.";
  return (
    <>
      <PageHero eyebrow="Endorsements" title={heroTitle} body={heroBody} />
      <section className="pw-section pw-content-unavailable" role="status"><h2>Content temporarily unavailable</h2><p>The public content service could not return endorsements. Please try again shortly.</p></section>
    </>
  );
}

function BoardPage({ cmsPage }: { cmsPage?: PastorWoodCmsPage | null }) {
  const heroTitle = cmsPage?.heroTitle || "Abiding in Christ Board Members";
  const heroBody = cmsPage?.heroBody || "We are fortunate to have the following people serving on our board.";
  return (
    <>
      <PageHero eyebrow="Board" title={heroTitle} body={heroBody} />
      <section className="pw-section pw-content-unavailable" role="status"><h2>Content temporarily unavailable</h2><p>The public content service could not return board members. Please try again shortly.</p></section>
    </>
  );
}

function DevotionalPage({ cmsPage }: { cmsPage?: PastorWoodCmsPage | null }) {
  const heroTitle = cmsPage?.heroTitle || "Weekly Devotional";
  const heroBody = cmsPage?.heroBody || "Recent devotional posts from Pastor Wood.";
  return (
    <>
      <PageHero eyebrow="Weekly Devotional" title={heroTitle} body={heroBody} />
      <section className="pw-section pw-content-unavailable" role="status"><h2>Content temporarily unavailable</h2><p>The public content service could not return devotionals. Please try again shortly.</p></section>
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
      <section className="pw-section pw-content-unavailable" role="status"><h2>Content temporarily unavailable</h2><p>The public content service could not return writings. Please try again shortly.</p></section>
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

function DonatePage({ cmsPage, donorDashboard = false, siteSettings }: { cmsPage?: PastorWoodCmsPage | null; donorDashboard?: boolean; siteSettings?: StrapiSiteSettings | null }) {
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
          <a className="pw-button pw-button--primary" href={donorDashboard ? `${originalSite}/donor-dashboard/` : getPublicDonationUrl(siteSettings?.donateButtonUrl)} target="_blank" rel="noreferrer noopener">{donorDashboard ? "Open donor dashboard" : "Open secure giving form"}</a>
        </section>
      )}
    </>
  );
}

function SubscriptionPrivacyNotice() {
  return (
    <section className="pw-section pw-policy-copy" aria-labelledby="subscription-privacy-notice">
      <h2 id="subscription-privacy-notice">Weekly devotional subscriptions</h2>
      <p>When you subscribe, we store your email address, the consent wording and version you accepted, the time of consent, and the page where you subscribed. We also store one-way keyed hashes derived from the requesting IP address and browser identifier to limit abuse; the raw values are not stored by the subscription form.</p>
      <h2>How the information is used</h2>
      <p>Subscription information is used to manage the Abiding in Christ devotional list. Authorized content managers can export the active list for delivery through the ministry&apos;s approved email provider. Suppressed addresses remain suppressed if a later signup is attempted.</p>
      <h2>Other websites and giving</h2>
      <p>Links to giving, Apple Podcasts, Wears Valley Ranch, and other organizations open their websites. Their privacy practices apply once you leave this site. This website does not collect payment-card information.</p>
      <h2>Questions or removal requests</h2>
      <p>Contact <a href="mailto:Radio@pastorwood.org">Radio@pastorwood.org</a> or call <a href="tel:18664122433">(866) 412-2433</a> to ask about this notice or request removal from the devotional list.</p>
    </section>
  );
}

function PrivacyPage({ cmsPage }: { cmsPage?: PastorWoodCmsPage | null }) {
  const heroTitle = cmsPage?.heroTitle || "Privacy, Terms & Conditions";
  const heroBody = cmsPage?.heroBody || "How Abiding in Christ handles information submitted through this website.";
  return (
    <>
      <PageHero eyebrow="Privacy" title={heroTitle} body={heroBody} />
      {cmsPage?.sections?.length ? <CmsPageSections sections={cmsPage.sections} /> : null}
      <SubscriptionPrivacyNotice />
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
    abiding: <AbidingInChristPage cmsPage={cmsPage} />,
    endorsements: <EndorsementsPage cmsPage={cmsPage} />,
    board: <BoardPage cmsPage={cmsPage} />,
    devotional: <DevotionalPage cmsPage={cmsPage} />,
    written: <WrittenResourcesPage cmsPage={cmsPage} />,
    contact: <ContactPage cmsPage={cmsPage} />,
    donate: <DonatePage cmsPage={cmsPage} siteSettings={siteSettings} />,
    donorDashboard: <DonatePage cmsPage={cmsPage} donorDashboard siteSettings={siteSettings} />,
    privacy: <PrivacyPage cmsPage={cmsPage} />,
  }[page];

  return <PastorWoodShell siteSettings={siteSettings}>{content}</PastorWoodShell>;
}

export async function PastorWoodRadioPage(_props: { slug?: string[] }) {
  const siteSettings = await getStrapiSiteSettings();
  return (
    <PastorWoodShell siteSettings={siteSettings}>
      <PageHero eyebrow="Radio Archive" title="Radio content temporarily unavailable" body="The public content service could not return the radio archive." />
      <section className="pw-section pw-content-unavailable" role="status"><h2>Please try again shortly</h2><p>No private episode data or research tools are exposed on this public fallback.</p></section>
    </PastorWoodShell>
  );
}
