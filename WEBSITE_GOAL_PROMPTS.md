# AIC Website `/goal` Prompts

Use this file to drive the website build with Codex. The intent is to make the website build runnable as a durable `/goal`, with clear phases, acceptance checks, and follow-up prompts.

## Build Target

Primary website repo:

```text
ssh finsvc:/home/openclaw/aic
```

Planning and data-pipeline repo:

```text
/Users/van/firebase/aic_podcast
```

Serving database:

```text
Postgres database: aic
```

Current source-of-truth planning docs:

- `PROJECT.md`
- `WEBSITE_PLAN.md`
- `postgres/README.md`
- `postgres/migrations/001_init.sql`
- `postgres/migrations/002_podtrac.sql`

Do not print secrets from `.env`. Do not push to GitHub unless explicitly asked.

## Design Direction To Preserve

Use Codex's Impeccable design skill. Treat the website as a product UI.

Visual direction:

- Name: Mountain Study Console.
- Emotional target: quiet desk in a Wears Valley cabin looking over the Smoky Mountains at sunrise.
- Interface target: serious scholarly production tool for sermon research, podcast intelligence, stats, and content drafting.
- Striking but soothing, not generic SaaS.
- Use original generated imagery inspired by Wears Valley, Tennessee, the Smoky Mountains, cabin porches, rural roads, fields, and small mountain churches.
- Keep product usability higher than decoration.

Avoid:

- generic dashboard card grids
- fake hero sections
- glassmorphism
- gradient text
- decorative blobs
- purple/blue SaaS gradients
- fake metrics
- public/private data leakage
- unlabeled estimated data

Core surfaces:

- Private owner console
- Stats
- Episode archive
- Episode detail
- Intelligence browser
- RAG chat
- Content studio
- Pipeline console
- Public episode site

## Master `/goal`

Paste this as the main goal when ready to start implementation:

```text
/goal Build the AIC website MVP as a secure Next.js App Router product app in ssh finsvc:/home/openclaw/aic, using the existing Postgres database aic as the serving database and the planning docs in /Users/van/firebase/aic_podcast as source context.

Read and respect PROJECT.md, WEBSITE_PLAN.md, WEBSITE_GOAL_PROMPTS.md, postgres/README.md, and any AGENTS.md, GEMINI.md, or CONTRIBUTING_AI.md files that exist. Use Codex's Impeccable design skill for frontend design. Treat this as a product UI, not a marketing site.

Design target: Mountain Study Console, a striking but soothing private owner console grounded in Wears Valley, Tennessee and the Smoky Mountains. It should feel like a calm sermon research desk in a cabin overlooking misty ridges at sunrise. Use restrained mineral mist gray, warm parchment surfaces, deep cypress green accents, muted clay/ochre warning tones, soft ink text, thin borders, 8px radii or less, and original generated imagery inspired by Wears Valley and the Smoky Mountains. Avoid generic SaaS dashboards, decorative gradients, glass panels, repeated metric cards, fake metrics, and card-heavy marketing layouts.

Implementation target:
1. Create or complete a Next.js App Router + TypeScript app.
2. Add Clerk auth exactly according to the Clerk rules in PROJECT.md.
3. Keep all database and AI credentials server-side only.
4. Connect to Postgres using DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD from env.
5. Build the private owner console first: Overview, Stats, Episodes, Episode Detail, RAG Chat, Content Studio, Pipeline.
6. Use real Postgres data from episodes, transcript_chunks, episode_intelligence, episode_intelligence_items, episode_intelligence_vectors, podtrac_episodes, podtrac_daily_activity, podtrac_countries, podtrac_activity_by_country, podtrac_clients, and podtrac_activity_by_client.
7. Preserve data caveats: exact episode-by-country stats do not exist yet, so do not present that as exact.
8. Build the app with source-backed trust cues: RAG answers and generated drafts must show retrieved sources, retrieval lanes, and tool usage.
9. Add a public website shell only after the private owner console MVP is working.
10. Keep the work staged, testable, and documented. Start the dev server and verify in the browser before reporting done.

MVP acceptance criteria:
- Authenticated private layout works.
- Signed-out users cannot access private routes.
- Overview reads live Postgres counts and shows pipeline warnings, including unmatched Podtrac episodes.
- Stats page matches the verified Podtrac clean-window total of 118,626 downloads.
- Episodes page lists real episodes and filters/searches real data.
- Episode detail shows metadata, transcript availability, intelligence summaries/items, and linked Podtrac stats.
- RAG Chat has a usable interface with source panel and retrieval trace. If answer generation is not wired yet, mock only the final model response but use real retrieval/source data and label the model path as pending.
- Content Studio has the TTS-safe sermon/article workflow shape, source controls, and preview surface.
- Pipeline page shows real coverage counts for transcripts, speech vectors, intelligence, intelligence vectors, Podtrac sync, and unmatched records.
- The UI follows the Mountain Study Console direction and passes responsive desktop/tablet/mobile checks.
- No secrets are printed or exposed in client bundles.
```

## Phase Prompts

Use these when you want the work broken into controlled stages instead of one large run.

### Phase 0: Product And Design Foundation

```text
/goal Prepare the AIC website product and design foundation before implementation.

Work in ssh finsvc:/home/openclaw/aic for website files and refer to /Users/van/firebase/aic_podcast for planning and data context. Read PROJECT.md, WEBSITE_PLAN.md, WEBSITE_GOAL_PROMPTS.md, postgres/README.md, and relevant repo instructions.

Use Impeccable as the primary frontend design skill. Create PRODUCT.md and DESIGN.md if they do not exist. Product register is product UI.

PRODUCT.md must define:
- private owner/editor/viewer users
- public visitor audience
- product purpose
- trust and source-backed principles
- private/public data boundaries
- tone: calm, grounded, scholarly, practical
- anti-references: generic SaaS dashboard, decorative hero, fake metrics, dark-blue analytics cliché

DESIGN.md must define:
- Mountain Study Console visual direction
- Wears Valley and Smoky Mountains image usage rules
- OKLCH color tokens: mineral mist, parchment, cypress, clay/ochre, soft ink
- typography scale
- spacing rhythm
- navigation model
- component states
- chart/data visualization rules
- RAG source/provenance display rules
- accessibility and responsive rules

Acceptance:
- PRODUCT.md and DESIGN.md exist.
- They are specific enough that another Codex run can implement the UI without inventing a generic dashboard.
- No secrets are included.
```

### Phase 1: Scaffold, Auth, And App Shell

```text
/goal Build the AIC website app shell with Clerk auth and the Mountain Study Console layout.

Use ssh finsvc:/home/openclaw/aic. Read PRODUCT.md, DESIGN.md, PROJECT.md, WEBSITE_PLAN.md, and WEBSITE_GOAL_PROMPTS.md first. Use Next.js App Router and TypeScript. Follow the Clerk rules in PROJECT.md exactly: use clerkMiddleware from @clerk/nextjs/server in proxy.ts, ClerkProvider inside body, imports from @clerk/nextjs or @clerk/nextjs/server, App Router only, Show instead of deprecated SignedIn/SignedOut.

Build:
- private app shell
- public app shell
- top rail navigation: Overview, Archive, Sources, Compose, Signals, Pipeline
- responsive private layout inspired by Mountain Study Console
- placeholder imagery components for Wears Valley/Smoky Mountain generated assets
- protected private routes
- public home/episodes shell

Acceptance:
- npm install/build/lint works, or document the exact blocker.
- Dev server runs.
- Signed-out private access redirects or blocks correctly.
- UI is visibly Mountain Study Console, not a generic SaaS dashboard.
```

### Phase 2: Postgres Data Layer And Health Page

```text
/goal Add the secure Postgres data layer for the AIC website and build a private health/overview data check.

Use ssh finsvc:/home/openclaw/aic. Read postgres/README.md and migrations. Load DB env vars server-side only. Do not expose secrets in client code or logs.

Build:
- server-only Postgres client module
- typed query helpers for counts
- private health route or Overview data endpoint
- queries for episodes, transcript_chunks, episode_intelligence, episode_intelligence_vectors, podtrac tables, sync tables if available
- error states for missing DB env or connection failure

Acceptance:
- Private page reads live Postgres counts.
- Counts include episodes, transcript chunks, intelligence rows/items/vectors, Podtrac episodes, Podtrac daily rows, matched/unmatched Podtrac episodes.
- No DB secret appears in rendered HTML, client bundle, logs, or errors.
```

### Phase 3: Overview And Stats

```text
/goal Build the private Overview and Stats pages using real Postgres data.

Use the Mountain Study Console design direction from PRODUCT.md and DESIGN.md. Avoid repeated metric-card grids. Use a calm archival canvas with source-backed operational signals.

Build Overview:
- corpus state
- Podtrac clean-window downloads
- linked/unmatched Podtrac count
- RAG/vector coverage
- recent or latest episodes
- pipeline warnings

Build Stats:
- date range controls
- downloads over time
- top episodes
- country breakdown
- client breakdown
- Podtrac link status

Important caveat:
- Do not show exact episode-by-country stats because the current Podtrac import does not contain that cross-tab.

Acceptance:
- Stats clean-window total equals 118,626 downloads for 2026-02-01 through 2026-04-30.
- Top episodes join from Podtrac to episodes through podtrac_episodes.track_id.
- The unmatched Podtrac episode is visible and not hidden.
- Desktop and mobile layouts are usable.
```

### Phase 4: Episode Archive And Detail

```text
/goal Build the Episode Archive and Episode Detail surfaces for the AIC website.

Use real Postgres data. Keep the interface dense but readable. Continue the Mountain Study Console design with archive timeline, source drawers, and sermon research cues.

Build Archive:
- searchable episode list
- filters for publish date, episode type, transcript availability, intelligence status, Podtrac link status
- compact stats per episode where available

Build Detail:
- episode metadata
- linked Podtrac stats
- executive summary and long summary
- transcript viewer from transcript_chunks ordered chronologically
- intelligence items grouped by scripture, story, sermon illustration, interview, book, person, place, organization, quote, topic
- source timestamps and speaker labels where available

Acceptance:
- Episode list uses real rows.
- Detail page opens from list.
- Transcript text is reconstructed from indexed chunks without including ads/announcements as if they were sermon speech.
- Intelligence items are source-visible and grouped clearly.
```

### Phase 5: RAG Chat

```text
/goal Build the private AIC RAG Chat interface with source visibility and retrieval trace.

Use the existing RAG behavior documented in PROJECT.md and WEBSITE_PLAN.md. The UI must support semantic transcript vectors, intelligence vectors, corpus discovery, full sermon retrieval, Bible passage retrieval, and long-form context gathering.

Build:
- chat page with source panel
- retrieval trace display showing lanes used: transcript vectors, intelligence vectors, corpus discovery, full sermon context, Bible passage
- source list with expandable chunks/episodes/passages
- model/provider status
- error states for Silo/Codex timeout, HTTP error, incomplete stream, missing embedding key, missing YouVersion key
- TTS-safe output toggle

Backend shape:
- server-only endpoint for query embedding using OpenAI text-embedding-3-small
- Postgres vector search over transcript_chunks and episode_intelligence_vectors
- SQL/full-text fallback for corpus-wide count/list questions
- Bible passage tool server-side only
- full sermon retrieval server-side only
- answer-generation wrapper for Silo/Codex, with request/response logging and secret redaction

Acceptance:
- A user can ask a question and see sources before or beside the answer.
- Retrieval sources are real even if final answer generation is temporarily mocked during early implementation.
- Long-form prompts can include full gathered context.
- Logs redact secrets.
```

### Phase 6: Content Studio

```text
/goal Build the AIC Content Studio for source-backed sermon, article, Bible study, devotional, and TTS-safe manuscript drafting.

Use Mountain Study Console design. The surface should feel like a calm sermon writing desk, not a generic form builder.

Build workflows:
- sermon draft
- article draft
- Bible study plan
- devotional series
- TTS-safe manuscript

Controls:
- passage selector
- source emphasis controls: sermons, interviews, stories, scripture references, full episodes
- output length
- tone/format
- TTS-safe toggle
- citation/source visibility toggle
- draft preview
- source review drawer

Guardrails:
- Do not imply generated material is a verbatim Pastor Wood sermon.
- TTS-safe mode should avoid markdown, bracket citations, verse-by-verse announcements, and awkward punctuation.

Acceptance:
- User can configure and preview a draft request.
- Source selection is explicit.
- Generated or mocked preview clearly distinguishes new generated content from source text.
```

### Phase 7: Pipeline Console

```text
/goal Build the private Pipeline console for AIC ingestion, vectorization, intelligence, and Podtrac sync visibility.

Use real database status where possible and clearly label any status that is not yet wired to a job runner.

Show:
- transcript coverage
- speech vector coverage
- episode intelligence coverage
- intelligence vector coverage
- Podtrac sync status
- unmatched Podtrac records
- failed or retryable intelligence rows
- OpenAI batch status placeholders if live batch polling is not yet wired
- recent sync runs

Actions may be read-only first:
- inspect rows
- copy command
- view logs placeholder
- retry action placeholder

Acceptance:
- Owner can tell if the corpus is current.
- Read-only views do not pretend to trigger jobs.
- Failed/unmatched states are visible.
```

### Phase 8: Public Website

```text
/goal Build the public AIC episode website after the private console MVP is working.

Public pages must never expose private Podtrac metrics, RAG logs, raw prompts, provider details, pipeline internals, or unreviewed generated drafts.

Build:
- public episode index
- public episode detail
- topic pages
- scripture reference pages
- public search
- SEO metadata

Public episode detail:
- title
- publish date
- summary
- scripture references
- topics
- transcript only if approved by public-content policy
- related episodes
- audio link when available

Acceptance:
- Signed-out users can browse public pages.
- Signed-out users cannot access private routes or private API data.
- Public data policy is enforced in code, not only in UI.
```

## Visual Asset Prompt For ChatGPT Image

Use this prompt to generate the initial website image set:

```text
Create original realistic website imagery for the AIC Mountain Study Console. Do not copy any existing photo. Generate four cohesive images inspired by Wears Valley, Tennessee and the Smoky Mountains:

1. Wide panoramic sunrise over Wears Valley-style rolling pasture and layered Smoky Mountain ridges with mist in the low valley, calm early light, natural and hopeful.
2. Cabin porch still life with Bible, notebook, pen, and small microphone on a wooden table, Smoky Mountains softly visible beyond.
3. Slim vertical rural Tennessee road with fence line, trees, fields, and distant mountains, quiet and grounded.
4. Small mountain chapel or simple country church near a field in morning light, peaceful and reverent.

The images should be natural, soothing, warm, and usable inside a product UI. Avoid stock-photo darkness, bokeh, dramatic fantasy lighting, people posing, logos, readable signage, and over-saturated colors. Palette: mineral mist gray, warm parchment, deep cypress, muted clay, soft ink.
```

## Detailed Acceptance Checklist

Run these checks before calling a phase done:

- `npm run lint`
- `npm run build`
- dev server starts
- browser check on desktop viewport
- browser check on mobile viewport
- private routes are protected
- public routes work signed out
- no secrets in rendered page, logs, or client code
- real Postgres queries work
- data caveats are labeled
- source provenance is visible for RAG/content features
- UI follows `PRODUCT.md` and `DESIGN.md`
- no generic repeated metric-card dashboard as the dominant visual system

## Suggested First Prompt

Start with Phase 0 and Phase 1 instead of the full master goal if you want a controlled first pass:

```text
/goal Complete Phase 0 and Phase 1 from WEBSITE_GOAL_PROMPTS.md. Create PRODUCT.md and DESIGN.md, then scaffold the Next.js App Router app with Clerk auth and the Mountain Study Console app shell. Stop after the dev server runs and the protected private shell is verified in the browser. Do not build the data-heavy pages yet. Do not push to GitHub.
```
