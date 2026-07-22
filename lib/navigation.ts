export type AicNavRole = "User" | "Admin" | "Content Manager" | "Research User" | "Read Only";

export type ConsoleNavItem = {
  href: string;
  label: string;
  description?: string;
  adminOnly?: boolean;
  contentOnly?: boolean;
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
    href: "/content",
    label: "Content",
    description: "Public site pages, posts, podcast uploads, newsletters, and media.",
    contentOnly: true,
    children: [
      {
        href: "/content",
        label: "Content overview",
        description: "Review the editorial portal plan and publishing workflow.",
      },
      {
        href: "/content/site-pages",
        label: "Site pages",
        description: "Edit evergreen public website pages and page sections.",
      },
      {
        href: "/content/posts",
        label: "Posts and writings",
        description: "Manage devotionals, written resources, and article drafts.",
      },
      {
        href: "/content/podcast",
        label: "Podcast uploads",
        description: "Upload MP3s, set metadata, and publish archive entries.",
      },
      {
        href: "/content/people",
        label: "People and board",
        description: "Manage authors, guests, staff, and board members.",
      },
      {
        href: "/content/endorsements",
        label: "Endorsements",
        description: "Manage public quotes, attribution, and ordering.",
      },
      {
        href: "/content/media",
        label: "Media library",
        description: "Upload private-by-default files with public metadata.",
      },
      {
        href: "/content/redirects",
        label: "Legacy redirects",
        description: "Map verified old-site paths to replacement URLs.",
      },
      {
        href: "/content/workflow",
        label: "Publishing workflow",
        description: "Review drafts, publication state, revisions, and audit attribution.",
      },
    ],
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
