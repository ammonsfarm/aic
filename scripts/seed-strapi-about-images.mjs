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

const jsonHeaders = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

const authHeaders = {
  Authorization: `Bearer ${token}`,
};

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
  const payload = await strapiJson(url, { headers: jsonHeaders });
  return payload.data?.[0] ?? null;
}

async function findUploadByName(name) {
  const url = new URL("/api/upload/files", baseUrl);
  url.searchParams.set("filters[name][$eq]", name);
  const payload = await strapiJson(url, { headers: jsonHeaders });
  return payload?.[0] ?? null;
}

async function uploadRemoteImage({ url, name, alternativeText }) {
  const existing = await findUploadByName(name);
  if (existing?.id) {
    return existing;
  }

  const imageResponse = await fetch(url);
  if (!imageResponse.ok) {
    throw new Error(`Could not fetch ${url}: ${imageResponse.status}`);
  }

  const arrayBuffer = await imageResponse.arrayBuffer();
  const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
  const file = new File([arrayBuffer], name, { type: contentType });
  const form = new FormData();
  form.append("files", file);
  form.append("fileInfo", JSON.stringify({ name, alternativeText }));

  const uploaded = await strapiJson(`${baseUrl}/api/upload`, {
    method: "POST",
    headers: authHeaders,
    body: form,
  });

  return uploaded[0];
}

const jimAndSusan = await uploadRemoteImage({
  url: "https://www.pastorwood.org/wp-content/uploads/2019/02/Jim-and-Susan-2018-10_5-300x240.jpg",
  name: "jim-and-susan-wood.jpg",
  alternativeText: "Pastor Jim Wood and Susan Wood",
});

const family = await uploadRemoteImage({
  url: "https://www.pastorwood.org/wp-content/uploads/2015/02/jimwoodfamily2013Christmas.jpg",
  name: "jim-wood-family.jpg",
  alternativeText: "Pastor Wood and family",
});

const about = await findPage("about");
if (!about?.documentId) {
  throw new Error("Could not find About page in Strapi.");
}

const sections = [
  {
    __component: "page-sections.image-text-section",
    eyebrow: "Biography",
    heading: "Early life and calling",
    body: "Jim Wood is the Founder of Wears Valley Ranch. Growing up in Montreat, North Carolina, Jim began preaching at age fifteen. After graduating from Gordon College in Massachusetts, Jim married Susan McDonald of Shreveport, Louisiana.\n\nThey began married life at French Camp Academy in Mississippi, where they were house parents and teachers for two years. From French Camp, Jim returned to New England and attended Gordon-Conwell Theological Seminary where he earned an M.A. in Church History.",
    image: jimAndSusan.id,
    imageSide: "right",
  },
  {
    __component: "page-sections.text-section",
    eyebrow: "Pastoral ministry",
    heading: "Pastoring and prayer among churches",
    body: "After pastoring in New England for five years, Jim was called as senior pastor of Mount Vernon Baptist Church in Sandy Springs, Georgia. He served there for six years. During that time he helped develop relationships among pastors of various denominations who covenanted to pray for one another, encourage one another, and hold one another accountable.",
  },
  {
    __component: "page-sections.image-text-section",
    eyebrow: "Wears Valley Ranch",
    heading: "A vision for children and families",
    body: "In 1991, Jim, Susan and their three sons left Mount Vernon to fulfill a vision for which they had prayed for over twenty years. In the Great Smoky Mountains in Tennessee, they established Wears Valley Ranch to provide Christian homes, education, and counseling for children from difficult family situations.\n\nHaving served as Executive Director of Wears Valley Ranch for nearly 30 years, Jim retired from this capacity in December 2020. He remains as the Ranch's Founder, continuing his ministry of teaching and preaching at the Ranch, on radio and elsewhere.\n\nJim's radio program, Abiding in Christ, airs weekdays on SiriusXM 131 satellite radio and is available on podcast. He and his wife, Susan, have authored 14 books and often lead seminars on marriage and parenting.",
    image: family.id,
    imageSide: "left",
  },
];

await strapiJson(`${baseUrl}/api/pages/${about.documentId}`, {
  method: "PUT",
  headers: jsonHeaders,
  body: JSON.stringify({ data: { sections } }),
});

console.log("Updated About page with image text sections.");
