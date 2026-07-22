import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

test("public app runtime dependencies stay on the verified security baseline", async () => {
  const manifest = await readJson("package.json");
  assert.equal(manifest.dependencies.next, "16.2.11");
  assert.equal(manifest.dependencies["@clerk/nextjs"], "7.5.22");
  assert.equal(manifest.dependencies.react, "19.2.6");
  assert.equal(manifest.dependencies["react-dom"], "19.2.6");
  assert.equal(manifest.devDependencies["eslint-config-next"], "16.2.11");
  assert.deepEqual(manifest.overrides, {
    postcss: "8.5.10",
    sharp: "0.35.0",
  });

  const lock = await readJson("package-lock.json");
  assert.equal(lock.packages["node_modules/next"].version, "16.2.11");
  assert.equal(lock.packages["node_modules/@clerk/shared"].version, "4.25.6");
  assert.equal(lock.packages["node_modules/js-cookie"].version, "3.0.7");
  assert.equal(lock.packages["node_modules/postcss"].version, "8.5.10");
  assert.equal(lock.packages["node_modules/sharp"].version, "0.35.0");
});

test("private Strapi omits unused public-user and cloud plugins", async () => {
  const manifest = await readJson("services/jimwood-cms/package.json");
  assert.equal(manifest.dependencies["@strapi/strapi"], "5.50.2");
  assert.equal(manifest.dependencies["@strapi/plugin-cloud"], undefined);
  assert.equal(manifest.dependencies["@strapi/plugin-users-permissions"], undefined);

  const plugins = await readFile(resolve(root, "services/jimwood-cms/config/plugins.ts"), "utf8");
  assert.doesNotMatch(plugins, /users-permissions/);

  const generatedTypes = await readFile(resolve(root, "services/jimwood-cms/types/generated/contentTypes.d.ts"), "utf8");
  assert.doesNotMatch(generatedTypes, /plugin::users-permissions/);

  const exampleEnv = await readFile(resolve(root, "services/jimwood-cms/.env.example"), "utf8");
  assert.doesNotMatch(exampleEnv, /^JWT_SECRET=/m);

  const server = await readFile(resolve(root, "services/jimwood-cms/config/server.ts"), "utf8");
  assert.match(server, /env\('HOST', '127\.0\.0\.1'\)/);
});

test("Strapi security overrides resolve to the tested lockfile versions", async () => {
  const manifest = await readJson("services/jimwood-cms/package.json");
  assert.deepEqual(manifest.overrides, {
    tar: "7.5.21",
    sharp: "0.35.0",
    dompurify: "3.4.12",
    "@rushstack/node-core-library": {
      ajv: "8.20.0",
    },
  });

  const lock = await readJson("services/jimwood-cms/package-lock.json");
  assert.equal(lock.packages["node_modules/tar"].version, "7.5.21");
  assert.equal(lock.packages["node_modules/sharp"].version, "0.35.0");
  assert.equal(lock.packages["node_modules/dompurify"].version, "3.4.12");
  assert.equal(lock.packages["node_modules/ajv"].version, "8.20.0");
  assert.equal(lock.packages["node_modules/ws"].version, "8.21.0");
  assert.equal(lock.packages["node_modules/nodemailer"].version, "9.0.1");
});
