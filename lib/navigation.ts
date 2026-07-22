export type AicNavRole = "User" | "Admin" | "Content Manager" | "Research User" | "Read Only";

export type ConsoleNavItem = {
  href: string;
  label: string;
  description?: string;
  roles?: AicNavRole[];
  children?: ConsoleNavItem[];
};

const allConsoleRoles: AicNavRole[] = ["Admin", "Content Manager", "Research User", "Read Only", "User"];
const researchConsoleRoles: AicNavRole[] = ["Admin", "Content Manager", "Research User"];
const internalReadRoles: AicNavRole[] = ["Admin", "Content Manager", "Research User", "Read Only"];
const contentConsoleRoles: AicNavRole[] = ["Admin", "Content Manager"];
const administratorRoles: AicNavRole[] = ["Admin"];

export const consoleNav: ConsoleNavItem[] = [
  {
    href: "/overview",
    label: "Overview",
    description: "Corpus state, reporting window, and warnings.",
    roles: administratorRoles,
  },
  {
    href: "/archive",
    label: "Archive",
    description: "Episodes, transcripts, and linked public records.",
    roles: internalReadRoles,
  },
  {
    href: "/sources",
    label: "Sources",
    description: "Intelligence, retrieval lanes, and source inspection.",
    roles: internalReadRoles,
  },
  {
    href: "/compose",
    label: "Compose",
    description: "Source-backed sermon, article, and manuscript drafting.",
    roles: researchConsoleRoles,
  },
  {
    href: "/content",
    label: "Content",
    description: "Public site pages, posts, podcast uploads, newsletters, and media.",
    roles: contentConsoleRoles,
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
        href: "/content/site-settings",
        label: "Site settings",
        description: "Manage shared branding, navigation, footer, and subscription settings.",
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
        href: "/content/newsletters",
        label: "Newsletters",
        description: "Review devotional subscribers and export consented recipients.",
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
    roles: allConsoleRoles,
  },
  {
    href: "/pipeline",
    label: "Pipeline",
    description: "Ingestion, vectorization, sync, and retry visibility.",
    roles: internalReadRoles,
  },
  {
    href: "/admin",
    label: "Admin",
    description: "Agent settings and user roles.",
    roles: administratorRoles,
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

export function consoleNavForRole(role: AicNavRole) {
  return consoleNav.filter((item) => item.roles?.includes(role) ?? false);
}

export function consoleHomeHref(role: AicNavRole) {
  if (role === "Admin") {
    return "/overview";
  }

  if (role === "Content Manager") {
    return "/content";
  }

  return "/podcast";
}

export const publicNav: ConsoleNavItem[] = [
  { href: "/", label: "Home" },
  { href: "/about-pastor-wood", label: "About" },
  { href: "/radio", label: "Radio" },
  { href: "/bible-study", label: "Devotionals" },
  { href: "/written-resources", label: "Writings" },
  { href: "/endorsements", label: "Endorsements" },
  { href: "/contact", label: "Contact" },
];
