import fs from "node:fs";

const canonicalEnvPath = "/mnt/storage/aic/.env";
const testMode = process.env.SEED_SITE_SETTINGS_TEST_MODE === "1" && process.env.NODE_ENV !== "production";
const envPath = testMode ? (process.env.AIC_ENV_FILE || "") : canonicalEnvPath;
if (!envPath || (!testMode && envPath !== canonicalEnvPath)) {
  throw new Error(`Site-settings seeding requires the canonical AIC environment at ${canonicalEnvPath}.`);
}

const authoritativeKeys = [
  "STRAPI_URL",
  "STRAPI_MANAGEMENT_URL",
  "STRAPI_PUBLIC_URL",
  "STRAPI_API_TOKEN",
  "STRAPI_READ_TOKEN",
  "STRAPI_MANAGEMENT_TOKEN",
  "STRAPI_API_TOKEN_TEMP_WRITE",
  "MAILCHIMP_API_KEY",
  "MAILCHIMP_SERVER_PREFIX",
  "MAILCHIMP_AUDIENCE_ID",
  "MAILCHIMP_WEBHOOK_SECRET",
  "SUBSCRIPTION_RATE_LIMIT_SECRET",
  "SUBSCRIPTION_UNSUBSCRIBE_SECRET",
];

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`AIC environment is missing: ${filePath}`);

  for (const key of authoritativeKeys) delete process.env[key];

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (authoritativeKeys.includes(key)) process.env[key] = value;
  }
}

loadEnv(envPath);

const urlValues = new Set(
  [process.env.STRAPI_MANAGEMENT_URL, process.env.STRAPI_URL]
    .map((value) => value?.trim().replace(/\/+$/, ""))
    .filter(Boolean),
);
const tokenValues = new Set(
  [process.env.STRAPI_API_TOKEN_TEMP_WRITE, process.env.STRAPI_MANAGEMENT_TOKEN, process.env.STRAPI_API_TOKEN]
    .map((value) => value?.trim())
    .filter(Boolean),
);
if (urlValues.size !== 1 || tokenValues.size !== 1) {
  throw new Error("Canonical AIC environment must contain one unambiguous Strapi mutation URL and token.");
}
const [baseUrl] = urlValues;
const [token] = tokenValues;
if (!testMode && baseUrl !== "http://127.0.0.1:1337") {
  throw new Error("Production site-settings mutations require Strapi at http://127.0.0.1:1337.");
}

if (!token) {
  throw new Error("Missing canonical Strapi management token.");
}

const providerKeys = [
  "MAILCHIMP_API_KEY",
  "MAILCHIMP_SERVER_PREFIX",
  "MAILCHIMP_AUDIENCE_ID",
  "MAILCHIMP_WEBHOOK_SECRET",
  "SUBSCRIPTION_RATE_LIMIT_SECRET",
  "SUBSCRIPTION_UNSUBSCRIBE_SECRET",
];
const providerValuesPresent = providerKeys.every((key) => Boolean(process.env[key]?.trim()));
const mailchimpServerPrefix = process.env.MAILCHIMP_SERVER_PREFIX?.trim().toLowerCase() || "";
const mailchimpAudienceId = process.env.MAILCHIMP_AUDIENCE_ID?.trim() || "";
const subscriptionProviderReady = providerValuesPresent
  && /^[a-z0-9-]{2,24}$/.test(mailchimpServerPrefix)
  && /^[a-f0-9]{10,32}$/i.test(mailchimpAudienceId);

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
const deploymentActor = {
  id: "aic-deployment",
  email: "deployment@pastorwood.org",
  name: "AIC deployment",
};

async function strapiJson(url, init = {}, options = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();

  if (options.allowNotFound && response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${url} failed ${response.status}: ${text.slice(0, 800)}`);
  }

  return text ? JSON.parse(text) : null;
}

const existingUrl = new URL("/api/site-setting", baseUrl);
existingUrl.searchParams.set("status", "draft");
const existing = await strapiJson(existingUrl, {}, { allowNotFound: true });
if (existing?.data?.documentId) {
  const baseline = await strapiJson(
    `${baseUrl}/api/editorial/site-setting/${encodeURIComponent(existing.data.documentId)}/baseline`,
    {
      method: "POST",
      body: JSON.stringify({
        actor: deploymentActor,
        note: "Adopted pre-workflow site settings as the immutable baseline without changing content.",
      }),
    },
  );
  let disabledUnconfiguredSubscription = false;
  if (!subscriptionProviderReady && existing.data.subscriptionEnabled === true) {
    if (!existing.data.updatedAt) {
      throw new Error("Existing site settings have no concurrency timestamp; refusing an unaudited subscription change.");
    }
    await strapiJson(
      `${baseUrl}/api/editorial/site-setting/${encodeURIComponent(existing.data.documentId)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          actor: deploymentActor,
          data: { subscriptionEnabled: false },
          expectedUpdatedAt: existing.data.updatedAt,
          note: "Disabled public subscriptions because the complete provider and signing configuration is not present.",
        }),
      },
    );
    disabledUnconfiguredSubscription = true;
  }
  console.log(JSON.stringify({
    initialized: false,
    adoptedBaseline: baseline?.adopted === true,
    reason: disabledUnconfiguredSubscription
      ? "unconfigured-subscriptions-disabled"
      : baseline?.adopted === true ? "site-settings-baseline-adopted" : "site-settings-already-audited",
    documentId: existing.data.documentId,
    subscriptionProviderReady,
  }, null, 2));
  process.exit(0);
}

async function findPageDocumentId(pageKey) {
  const url = new URL("/api/pages", baseUrl);
  url.searchParams.set("filters[pageKey][$eq]", pageKey);
  url.searchParams.set("status", "draft");
  url.searchParams.set("pagination[pageSize]", "1");
  const payload = await strapiJson(url);
  return payload.data?.[0]?.documentId ?? null;
}

async function navItem({ label, url = "", pageKey = "", order, active = true }) {
  return {
    label,
    url,
    page: pageKey ? await findPageDocumentId(pageKey) : null,
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
  await navItem({ label: "Podcasts", url: "https://podcasts.apple.com/us/podcast/abiding-in-christ-w-jim-wood/id375149712", order: 40 }),
  await navItem({ label: "Weekly Devotional", pageKey: "bible-study", url: "/bible-study/", order: 50 }),
  await navItem({ label: "Written Resources", pageKey: "written-resources", url: "/written-resources/", order: 60 }),
  await navItem({ label: "Speaking / Contact Us", pageKey: "contact", url: "/contact/", order: 70 }),
  await navItem({ label: "Donate", pageKey: "donate", url: "/donate/", order: 80 }),
];

const footerNavigation = [
  await navItem({ label: "Wears Valley Ranch", url: "https://wvr.org/", order: 10 }),
  await navItem({ label: "Covenant Community Church", url: "https://www.cccwearsvalley.org/", order: 20 }),
  await navItem({ label: "About Pastor Wood", pageKey: "about", url: "/about-pastor-wood/", order: 30 }),
  await navItem({ label: "Board Members", pageKey: "board-members", url: "/board-members/", order: 40 }),
  await navItem({ label: "Privacy, Terms & Conditions", pageKey: "privacy-terms-conditions", url: "/privacy-terms-conditions/", order: 50 }),
  await navItem({ label: "Bible Study", pageKey: "bible-study", url: "/bible-study/", order: 60 }),
  await navItem({ label: "Radio Shows", url: "/radio/", order: 70 }),
  await navItem({ label: "Written Resources", pageKey: "written-resources", url: "/written-resources/", order: 80 }),
  await navItem({ label: "Speaking Request", pageKey: "contact", url: "/contact/", order: 90 }),
  await navItem({ label: "Contact", pageKey: "contact", url: "/contact/", order: 100 }),
  await navItem({ label: "Endorsements", pageKey: "endorsements", url: "/endorsements/", order: 110 }),
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
    donorDashboardUrl: "https://www.pastorwood.org/donor-dashboard/",
    headerLogo: null,
    subscriptionEnabled: subscriptionProviderReady,
  },
};

await strapiJson(`${baseUrl}/api/editorial/site-setting`, {
  method: "POST",
  body: JSON.stringify({
    ...payload,
    actor: deploymentActor,
    note: "Initialized the first site-settings draft during deployment.",
  }),
});

const verifyUrl = new URL("/api/site-setting", baseUrl);
verifyUrl.searchParams.set("status", "draft");
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
  donorDashboardUrl: data.donorDashboardUrl,
  subscriptionEnabled: data.subscriptionEnabled,
  subscriptionProviderReady,
  initialized: true,
}, null, 2));
