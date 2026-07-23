# Dependency security baseline

Last reviewed: 2026-07-22

This document records the production dependency decisions for the AIC Next.js
application and its private Strapi service. Audit totals count affected package
nodes, not distinct advisories.

## Verified baseline

| Application | Before | After |
| --- | ---: | ---: |
| AIC / Next.js | 5 (4 high, 1 moderate) | 0 |
| Strapi | 40 (1 critical, 11 high, 20 moderate, 8 low) | 16 (1 high, 10 moderate, 5 low) |

## Original advisory paths

| Path | Affected range | Resolution |
| --- | --- | --- |
| `next@16.2.5` -> [GHSA-26hh-7cqf-hhc6](https://github.com/advisories/GHSA-26hh-7cqf-hhc6) | `>=16.0.0 <16.2.6` | Next 16.2.11 |
| `next` -> `postcss@8.4.31` -> [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) | `<8.5.10` | PostCSS 8.5.10 override |
| `next` -> `sharp@0.34.5` -> [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) | `<0.35.0` | sharp 0.35.0 override |
| `@clerk/nextjs@7.3.1` -> `@clerk/shared@4.10.0` -> `js-cookie@3.0.5` -> [GHSA-qjx8-664m-686j](https://github.com/advisories/GHSA-qjx8-664m-686j) | `<=3.0.5` | Clerk 7.5.22 resolves js-cookie 3.0.7 |
| `@strapi/cloud-cli` and `@strapi/data-transfer` -> `tar@7.5.16` -> [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw), [GHSA-w8wr-v893-vjvp](https://github.com/advisories/GHSA-w8wr-v893-vjvp), [GHSA-8x88-c5mf-7j5w](https://github.com/advisories/GHSA-8x88-c5mf-7j5w), [GHSA-gvwx-54wh-qm9j](https://github.com/advisories/GHSA-gvwx-54wh-qm9j) | through `<=7.5.18` | tar 7.5.21 patch override |
| `@strapi/data-transfer` -> `ws@8.20.1` -> [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) | `>=8 <8.21.0` | Strapi 5.50.2 resolves ws 8.21.0 |
| `@strapi/email` -> sendmail provider -> `nodemailer@8.0.9` -> [GHSA-p6gq-j5cr-w38f](https://github.com/advisories/GHSA-p6gq-j5cr-w38f) | `<=9.0.0` | Strapi 5.50.2 resolves Nodemailer 9.0.1 |
| `@strapi/upload` -> `sharp@0.33.5` -> [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) | `<0.35.0` | sharp 0.35.0 override |
| `@strapi/content-manager` -> `dompurify@3.4.11` -> [GHSA-c2j3-45gr-mqc4](https://github.com/advisories/GHSA-c2j3-45gr-mqc4) | `<=3.4.11` | DOMPurify 3.4.12 patch override |
| Rushstack tooling -> `ajv@8.13.0` -> [GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6) | `>=7.0.0-alpha.0 <8.18.0` | AJV 8.20.0 same-major override |
| build/admin tools -> `brace-expansion@1.1.15` and `fast-uri@3.1.3` | `<1.1.16` and `3.0.0 - 3.1.3` | lock refresh to 1.1.16 and 3.1.4 |
| unused Users & Permissions -> Grant/Purest -> UUID/elliptic | UUID `<11.1.1`; elliptic `<=6.6.1` | remove unused plugin and configuration |

Run the same production-only checks with:

```bash
npm audit --omit=dev
npm --prefix services/jimwood-cms audit --omit=dev
```

The root application pins Next.js 16.2.11, Clerk 7.5.22, React 19.2.6,
React DOM 19.2.6, and the aligned ESLint configuration. Overrides hold PostCSS
at 8.5.10 and sharp at 0.35.0 until Next.js declares those fixed releases
directly. This clears the Next middleware/proxy bypass, PostCSS CSS-stringify,
sharp/libvips, and Clerk-to-js-cookie audit paths.

Strapi is pinned to 5.50.2. The deployment does not use Strapi Cloud or
Users & Permissions: AIC editorial access uses a custom least-privilege Strapi
content API token and the user-facing site does not use Strapi end-user
accounts. Both optional plugins and the unused Users & Permissions JWT secret
were removed. The patch update also moves the data-transfer WebSocket client to
8.21.0 and the sendmail provider to Nodemailer 9.0.1.

Narrow overrides are limited to packages whose fixed release preserves the
used API surface:

- tar 7.5.21, a patch update used by Strapi CLI/data transfer;
- DOMPurify 3.4.12, a patch update used by the prebuilt admin;
- AJV 8.20.0, the same major used under Rushstack tooling;
- sharp 0.35.0, verified with a native PNG-to-WebP transform, Strapi build, and
  isolated Strapi startup contract.

Do not run `npm audit fix --force`. npm currently proposes Strapi 4.x package
versions as a supposed fix; that is a semantic downgrade and is incompatible
with the Strapi 5 content models and document APIs.

## Residual Strapi findings

The 16 remaining audit nodes are propagation from four leaf dependency areas:

- [GHSA-866g-f22w-33x8](https://github.com/advisories/GHSA-866g-f22w-33x8)
  affects `@ai-sdk/provider-utils <=3.0.97` with low-severity
  resource consumption.
  It is bundled through Strapi's content-type-builder AI UI, which the AIC
  custom editors do not call. There is no fixed compatible 3.x release; forcing
  the next major would replace an API pinned by Strapi.
- [GHSA-frvp-7c67-39w9](https://github.com/advisories/GHSA-frvp-7c67-39w9)
  affects `@hono/node-server <2.0.5` with an encoded-backslash traversal in
  Hono's Windows static-file adapter.
  This service runs on Linux and does not expose the MCP adapter. The fixed
  Hono 2.x release is outside the SDK's declared 1.x range.
- [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)
  affects `esbuild <=0.24.2` in the development server. Production uses
  `strapi start` with
  a prebuilt admin; it never runs the Vite/esbuild development server.
- Vite 5.4.21 remains reported for
  [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9),
  [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3),
  and [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff).
  The reported ranges end at Vite 6.4.1 or 6.4.2. These concern
  optimized-dependency source maps or Windows-only editor/path
  handling in the development server. A fixed Vite version is outside Strapi's
  exact 5.4.21 dependency, so a major override was rejected.

The service contract binds Strapi to `127.0.0.1`, validates that it does not
listen beyond loopback, keeps its API token in a mode-0700 runtime directory,
and exposes content through the AIC application. Strapi admin and development
servers are not publicly routed. These controls reduce reachability of the
accepted build/admin-only findings but do not erase them; recheck each time
Strapi publishes a compatible update.

A clean Strapi install still emits deprecation notices for `inflight@1.0.6`,
`rimraf@3.0.2`, and `glob@7.2.3` through
`@strapi/admin -> react-query -> broadcast-channel`, plus
`@koa/router@12.0.2` directly through Strapi core/types. None is a direct AIC
dependency. Major overrides were rejected because they would replace
Strapi-owned APIs; track their removal in a compatible Strapi release.

## Upgrade procedure

1. Update direct packages without changing the Strapi major.
2. Refresh both lockfiles and review every override against upstream ranges.
3. Run root tests, type checking, lint, and a production Next.js build.
4. Run Strapi tests/build plus the root Strapi operations contract tests. Perform
   deployed service acceptance only against the canonical existing AIC database;
   do not create a disposable or restored validation database.
5. Exercise Next image optimization and the sharp transform test.
6. Re-run both production audits and update this document when counts change.
