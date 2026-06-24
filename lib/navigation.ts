export type ConsoleNavItem = {
  href: string;
  label: string;
  description: string;
  adminOnly?: boolean;
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
    href: "/podcast",
    label: "Podcast",
    description: "Podtrac trends, listenership, and audience breakdowns.",
  },
  {
    href: "/pipeline",
    label: "Pipeline",
    description: "Ingestion, vectorization, sync, and retry visibility.",
  },
  {
    href: "/admin",
    label: "Admin",
    description: "Agent settings and user roles.",
    adminOnly: true,
  },
];

export const publicNav = [
  { href: "/", label: "Home" },
  { href: "/episodes", label: "Episodes" },
  { href: "/sermons", label: "Sermons" },
  { href: "/research", label: "Research" },
  { href: "/reading-plan", label: "Reading Plan" },
  { href: "/podcast", label: "Podcast" },
];
