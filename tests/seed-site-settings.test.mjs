import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function runSeed(baseUrl, provider = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const sandbox = mkdtempSync(`${tmpdir()}/aic-site-settings-seed-`);
    const envFile = resolve(sandbox, ".env");
    writeFileSync(envFile, [
      `STRAPI_URL=${baseUrl}`,
      "STRAPI_API_TOKEN_TEMP_WRITE=test-write-token",
      `MAILCHIMP_API_KEY=${provider.apiKey || "test-us21"}`,
      `MAILCHIMP_SERVER_PREFIX=${provider.serverPrefix || "us21"}`,
      `MAILCHIMP_AUDIENCE_ID=${provider.audienceId || "9ad7bbba36"}`,
      "MAILCHIMP_WEBHOOK_SECRET=webhook",
      "SUBSCRIPTION_RATE_LIMIT_SECRET=rate",
      "SUBSCRIPTION_UNSUBSCRIBE_SECRET=unsubscribe",
      `PASTORWOOD_SUBSCRIPTIONS_ENABLED=${provider.runtimeEnabled ? "true" : "false"}`,
      "",
    ].join("\n"));
    const child = spawn(process.execPath, ["scripts/seed-strapi-site-settings.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "test",
        SEED_SITE_SETTINGS_TEST_MODE: "1",
        AIC_ENV_FILE: envFile,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      rmSync(sandbox, { recursive: true, force: true });
      resolveRun({ code, stdout, stderr });
    });
  });
}

test("legacy site settings are adopted once as an immutable baseline without overwriting content", async (t) => {
  const baselineBodies = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    assert.equal(request.headers.authorization, "Bearer test-write-token");

    if (request.method === "GET" && url.pathname === "/api/site-setting") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        data: { documentId: "settings-legacy", siteName: "Existing editor-managed settings" },
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/editorial/site-setting/settings-legacy/baseline") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      await once(request, "end");
      baselineBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        data: { documentId: "settings-legacy", siteName: "Existing editor-managed settings" },
        adopted: baselineBodies.length === 1,
      }));
      return;
    }

    response.statusCode = 500;
    response.end(`unexpected request: ${request.method} ${url.pathname}`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const first = await runSeed(baseUrl);
  const second = await runSeed(baseUrl);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  assert.match(first.stdout, /"reason": "site-settings-baseline-adopted"/);
  assert.match(second.stdout, /"reason": "site-settings-already-audited"/);
  assert.equal(baselineBodies.length, 2);
  assert.deepEqual(baselineBodies[0].actor, {
    id: "aic-deployment",
    email: "deployment@pastorwood.org",
    name: "AIC deployment",
  });
  assert.match(baselineBodies[0].note, /without changing content/i);
});

test("a new draft site-settings singleton is initialized and verified through the draft API", async (t) => {
  const initializationBodies = [];
  let initialLookupCount = 0;
  let verificationCount = 0;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    assert.equal(request.headers.authorization, "Bearer test-write-token");

    if (request.method === "GET" && url.pathname === "/api/site-setting") {
      assert.equal(url.searchParams.get("status"), "draft");
      if (!url.searchParams.has("populate[topNavigation][populate]")) {
        initialLookupCount += 1;
        response.statusCode = 404;
        response.end(JSON.stringify({ data: null }));
        return;
      }

      verificationCount += 1;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        data: {
          documentId: "settings-new",
          siteName: "Abiding in Christ",
          topNavigation: initializationBodies.at(-1)?.data?.topNavigation ?? [],
          utilityNavigation: initializationBodies.at(-1)?.data?.utilityNavigation ?? [],
          footerNavigation: initializationBodies.at(-1)?.data?.footerNavigation ?? [],
          showDonateButton: false,
          donateButtonLabel: "Donate",
          subscriptionEnabled: initializationBodies.at(-1)?.data?.subscriptionEnabled ?? false,
        },
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/pages") {
      assert.equal(url.searchParams.get("status"), "draft");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [] }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/editorial/site-setting") {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      await once(request, "end");
      initializationBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: { documentId: "settings-new" } }));
      return;
    }

    response.statusCode = 500;
    response.end(`unexpected request: ${request.method} ${url.pathname}`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const result = await runSeed(baseUrl);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(initialLookupCount, 1);
  assert.equal(verificationCount, 1);
  assert.equal(initializationBodies.length, 1);
  assert.equal(initializationBodies[0].data.siteName, "Abiding in Christ");
  assert.equal(initializationBodies[0].data.showDonateButton, false);
  assert.equal(initializationBodies[0].data.donateButtonUrl, "");
  assert.equal(initializationBodies[0].data.donorDashboardUrl, "");
  assert.equal(initializationBodies[0].data.subscriptionEnabled, false);
  assert.deepEqual(initializationBodies[0].actor, {
    id: "aic-deployment",
    email: "deployment@pastorwood.org",
    name: "AIC deployment",
  });
  assert.match(initializationBodies[0].note, /initialized the first site-settings draft/i);
  assert.match(result.stdout, /"initialized": true/);
  assert.match(result.stdout, /"siteName": "Abiding in Christ"/);
  assert.match(result.stdout, /"subscriptionRuntimeEnabled": false/);

  const runtimeReady = await runSeed(baseUrl, { runtimeEnabled: true });
  assert.equal(runtimeReady.code, 0, runtimeReady.stderr);
  assert.equal(initializationBodies.length, 2);
  assert.equal(initializationBodies[1].data.subscriptionEnabled, false);
  assert.match(runtimeReady.stdout, /"subscriptionLaunchReady": true/);

  const malformed = await runSeed(baseUrl, {
    serverPrefix: "evil.example.com/path",
    audienceId: "not-an-audience",
  });
  assert.equal(malformed.code, 0, malformed.stderr);
  assert.equal(initializationBodies.length, 3);
  assert.equal(initializationBodies[2].data.subscriptionEnabled, false);
  assert.match(malformed.stdout, /"subscriptionProviderReady": false/);
});
