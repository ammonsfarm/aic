import fs from "node:fs";

function loadEnv(path) {
  if (!fs.existsSync(path)) return;

  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(".env.local");
loadEnv(".env");

const baseUrl = (process.env.STRAPI_URL || "http://localhost:1337").replace(/\/+$/, "");
const token = process.env.STRAPI_API_TOKEN_TEMP_WRITE || process.env.STRAPI_API_TOKEN || "";

if (!token) {
  throw new Error("Missing STRAPI_API_TOKEN_TEMP_WRITE or STRAPI_API_TOKEN.");
}

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

const pages = [
  {
    pageKey: "donate",
    slug: "donate",
    title: "Donate",
    heroTitle: "Donate Today",
    heroBody: "Donation processing and donor account access remain on the original Pastor Wood site for now.",
  },
  {
    pageKey: "donor-dashboard",
    slug: "donor-dashboard",
    title: "Donor Dashboard",
    heroTitle: "Donor Dashboard",
    heroBody: "Donation processing and donor account access remain on the original Pastor Wood site for now.",
  },
  {
    pageKey: "bible-study",
    slug: "bible-study",
    title: "Weekly Devotional",
    heroTitle: "Weekly Devotional",
    heroBody: "Recent devotional posts from Pastor Wood. Full post pages remain on the original Pastor Wood site for now.",
  },
  {
    pageKey: "written-resources",
    slug: "written-resources",
    title: "Written Resources",
    heroTitle: "Written Resources from Pastor Jim Wood",
    heroBody: "Here are resources that we hope will bless you.",
  },
  {
    pageKey: "endorsements",
    slug: "endorsements",
    title: "Endorsements",
    heroTitle: "Additional Endorsements for Pastor Wood",
    heroBody: "Public endorsements from ministry leaders and friends of the work.",
  },
  {
    pageKey: "board-members",
    slug: "board-members",
    title: "Board Members",
    heroTitle: "Abiding in Christ Board Members",
    heroBody: "We are fortunate to have the following people serving on our board.",
  },
  {
    pageKey: "privacy-terms-conditions",
    slug: "privacy-terms-conditions",
    title: "Privacy, Terms & Conditions",
    heroTitle: "Privacy, Terms & Conditions",
    heroBody: "The original privacy, terms, and conditions page remains the current policy source.",
  },
];

async function strapiJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${url} failed ${response.status}: ${text.slice(0, 600)}`);
  }

  return body;
}

async function findPage(pageKey) {
  const url = new URL("/api/pages", baseUrl);
  url.searchParams.set("filters[pageKey][$eq]", pageKey);
  url.searchParams.set("status", "draft");
  url.searchParams.set("pagination[pageSize]", "1");
  const payload = await strapiJson(url, { headers });
  return payload.data?.[0] ?? null;
}

async function savePage(page) {
  const existing = await findPage(page.pageKey);
  const payload = {
    data: {
      ...page,
      seoTitle: page.title,
      seoDescription: page.heroBody,
    },
  };
  const url = existing?.documentId ? `${baseUrl}/api/pages/${existing.documentId}` : `${baseUrl}/api/pages`;
  const method = existing?.documentId ? "PUT" : "POST";
  await strapiJson(url, { method, headers, body: JSON.stringify(payload) });
  console.log(`${existing ? "Updated" : "Created"} draft ${page.pageKey}`);
}

for (const page of pages) {
  await savePage(page);
}
