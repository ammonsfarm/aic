import fs from "node:fs";

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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

async function strapiJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${url} failed ${response.status}: ${text.slice(0, 800)}`);
  }

  return text ? JSON.parse(text) : null;
}

async function findPageId(pageKey) {
  const url = new URL("/api/pages", baseUrl);
  url.searchParams.set("filters[pageKey][$eq]", pageKey);
  url.searchParams.set("status", "draft");
  url.searchParams.set("pagination[pageSize]", "1");
  const payload = await strapiJson(url);
  return payload.data?.[0]?.id ?? null;
}

async function navItem({ label, url = "", pageKey = "", order, active = true }) {
  return {
    label,
    url,
    page: pageKey ? await findPageId(pageKey) : null,
    order,
    active,
  };
}

const topNavigation = [
  await navItem({ label: "Home", pageKey: "home", url: "/", order: 10 }),
  await navItem({ label: "About Us", pageKey: "about", url: "/about-pastor-wood/", order: 20 }),
  await navItem({ label: "Radio", url: "/radio/", order: 30 }),
  await navItem({ label: "Endorsements", pageKey: "endorsements", url: "/endorsements/", order: 40 }),
  await navItem({ label: "Contact", pageKey: "contact", url: "/contact/", order: 50 }),
];

const utilityNavigation = [
  await navItem({ label: "Pastor Jim Wood's Bio", pageKey: "about", url: "/about-pastor-wood/", order: 10 }),
  await navItem({ label: "Books", url: "https://wvr.org/bookstore/", order: 20 }),
  await navItem({ label: "Radio Broadcasts", url: "/radio/", order: 30 }),
  await navItem({ label: "Podcasts", url: "https://itunes.apple.com/us/podcast/abiding-in-christ-w-jim-wood/id375149712?mt=2", order: 40 }),
  await navItem({ label: "Weekly Devotional", pageKey: "bible-study", url: "/bible-study/", order: 50 }),
  await navItem({ label: "Written Resources", pageKey: "written-resources", url: "/written-resources/", order: 60 }),
  await navItem({ label: "Speaking / Contact Us", pageKey: "contact", url: "/contact/", order: 70 }),
  await navItem({ label: "Donate", pageKey: "donate", url: "/donate/", order: 80 }),
];

const footerNavigation = [
  await navItem({ label: "Wears Valley Ranch", url: "https://wvr.org/", order: 10 }),
  await navItem({ label: "Covenant Community Church", url: "http://www.cccwearsvalley.org/", order: 20 }),
  await navItem({ label: "About Pastor Wood", pageKey: "about", url: "/about-pastor-wood/", order: 30 }),
  await navItem({ label: "Board Members", pageKey: "board-members", url: "/board-members/", order: 40 }),
  await navItem({ label: "Privacy, Terms & Conditions", pageKey: "privacy-terms-conditions", url: "/privacy-terms-conditions/", order: 50 }),
  await navItem({ label: "Bible Study", pageKey: "bible-study", url: "/bible-study/", order: 60 }),
  await navItem({ label: "Radio Shows", url: "/radio/", order: 70 }),
  await navItem({ label: "Written Resources", pageKey: "written-resources", url: "/written-resources/", order: 80 }),
  await navItem({ label: "Speaking Request", pageKey: "contact", url: "/contact/", order: 90 }),
  await navItem({ label: "Contact", pageKey: "contact", url: "/contact/", order: 100 }),
  await navItem({ label: "Endorsements", pageKey: "endorsements", url: "/endorsements/", order: 110 }),
  await navItem({ label: "RSS", url: "https://www.pastorwood.org/feed/", order: 120 }),
];

const payload = {
  data: {
    siteName: "Abiding in Christ",
    topNavigation,
    utilityNavigation,
    footerNavigation,
    footerText: "A ministry of Jim Wood.",
    copyrightText: `© ${new Date().getFullYear()} Abiding in Christ. All rights reserved.`,
    showDonateButton: true,
    donateButtonLabel: "Donate",
    donateButtonUrl: "/donate/",
  },
};

await strapiJson(`${baseUrl}/api/site-setting`, {
  method: "PUT",
  body: JSON.stringify(payload),
});

const verifyUrl = new URL("/api/site-setting", baseUrl);
verifyUrl.searchParams.set("populate[topNavigation][populate]", "page");
verifyUrl.searchParams.set("populate[footerNavigation][populate]", "page");
verifyUrl.searchParams.set("populate[utilityNavigation][populate]", "page");
const verify = await strapiJson(verifyUrl);
const data = verify.data;
console.log(JSON.stringify({
  siteName: data.siteName,
  topNavigation: data.topNavigation?.length ?? 0,
  utilityNavigation: data.utilityNavigation?.length ?? 0,
  footerNavigation: data.footerNavigation?.length ?? 0,
  showDonateButton: data.showDonateButton,
  donateButtonLabel: data.donateButtonLabel,
}, null, 2));
