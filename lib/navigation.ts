export type ConsoleNavItem = {
  href: string;
  label: string;
  description: string;
};

export const consoleNav: ConsoleNavItem[] = [
  {
    href: "/overview",
    label: "Overview",
    description: "Corpus state, reporting window, and warnings.",
  },
  {
    href: "/archive",
    label: "Archive",
    description: "Episodes, transcripts, and linked public records.",
  },
  {
    href: "/sources",
    label: "Sources",
    description: "Intelligence, retrieval lanes, and source inspection.",
  },
  {
    href: "/compose",
    label: "Compose",
    description: "Source-backed sermon, article, and manuscript drafting.",
  },
  {
    href: "/signals",
    label: "Signals",
    description: "Stats, Podtrac trends, and audience breakdowns.",
  },
  {
    href: "/pipeline",
    label: "Pipeline",
    description: "Ingestion, vectorization, sync, and retry visibility.",
  },
];

export const publicNav = [
  { href: "/", label: "Home" },
  { href: "/episodes", label: "Episodes" },
  { href: "/stats", label: "Stats" },
  { href: "https://www.pastorwood.org/about-pastor-wood/", label: "About" },
  { href: "https://www.pastorwood.org/radio", label: "Radio" },
  { href: "https://itunes.apple.com/us/podcast/abiding-in-christ-w-jim-wood/id375149712?mt=2", label: "Podcast" },
  { href: "https://wvr.org/bookstore/", label: "Books" },
  { href: "https://www.pastorwood.org/contact/", label: "Contact" },
];
