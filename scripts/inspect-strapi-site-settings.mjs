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
const token = process.env.STRAPI_API_TOKEN || process.env.STRAPI_API_TOKEN_TEMP_WRITE || "";
const url = new URL("/api/site-setting", baseUrl);
url.searchParams.set("status", "published");
url.searchParams.set("populate[topNavigation][populate]", "page");
url.searchParams.set("populate[footerNavigation][populate]", "page");
url.searchParams.set("populate[utilityNavigation][populate]", "page");

const response = await fetch(url, {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});

console.log("status", response.status);
const payload = await response.json();
const data = payload.data || {};

for (const sectionName of ["topNavigation", "utilityNavigation", "footerNavigation"]) {
  console.log(`\n${sectionName}`);
  for (const item of data[sectionName] || []) {
    console.log(JSON.stringify({
      id: item.id,
      label: item.label,
      order: item.order,
      active: item.active,
      url: item.url,
      pageKey: item.page?.pageKey ?? null,
      slug: item.page?.slug ?? null,
    }));
  }
}
