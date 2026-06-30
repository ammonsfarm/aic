export type ConsoleNavItem = {
  href: string;
  label: string;
  description?: string;
  adminOnly?: boolean;
  children?: ConsoleNavItem[];
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
    children: [
      {
        href: "/admin",
        label: "Admin overview",
        description: "Review secured console settings.",
      },
      {
        href: "/admin#agent-settings",
        label: "Agent settings",
        description: "Model, API key, and retrieval configuration.",
      },
      {
        href: "/admin#user-security",
        label: "User security",
        description: "Assign and review user roles.",
      },
    ],
  },
];

export const publicNav: ConsoleNavItem[] = [
  { href: "/", label: "Home" },
  { href: "/episodes", label: "Episodes" },
  { href: "/sermons", label: "Sermons" },
  { href: "/writings", label: "Writings" },
  { href: "/research", label: "Research" },
  { href: "/reading-plan", label: "Reading Plan" },
  { href: "/podcast", label: "Podcast" },
];
