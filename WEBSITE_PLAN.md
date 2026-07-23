# AIC Website Plan

## Purpose

Build a secure website around the AIC podcast corpus that serves two audiences:

1. Private owner/editor users who need stats, corpus intelligence, RAG chat, source-backed writing tools, and pipeline visibility.
2. Public visitors who need to browse episodes, read summaries, search public content, and view transcripts where approved.

The website uses only the existing PostgreSQL database at
`192.168.1.106:5432`, with its canonical settings in `/mnt/storage/aic/.env`.
SQLite files remain read-only staging/audit inputs for historical local imports;
they are not PostgreSQL copies, restore targets, or serving-database substitutes.

## Design Direction

Use Codex's Impeccable product-design guidance for this project. This is a product UI, not a marketing-first site.

Design principles:

- Prioritize fast scanning, trust, source visibility, and repeat workflows.
- Use a restrained interface: tinted neutrals, one primary accent, clear semantic states.
- Use familiar product patterns: sidebar navigation, top utility bar, tabs, filters, tables, detail panels, and command-style search.
- Avoid generic SaaS hero sections, decorative gradients, glass panels, fake metrics, and card-heavy marketing layouts.
- Make evidence visible: every RAG answer, generated article, and insight should show where it came from.
- Keep dense areas readable: tables, source lists, and transcript panels need compact spacing but strong hierarchy.
- Design mobile as a useful companion view, but optimize the private console for desktop and tablet work.

Project setup gap:

- Add `PRODUCT.md` before UI implementation to capture users, tone, product promises, and anti-references.
- Add `DESIGN.md` before or during the first UI pass to document colors, typography, layout rules, components, and states.

Implementation prompts:

- Use `WEBSITE_GOAL_PROMPTS.md` for the master `/goal`, phase prompts, and acceptance checklist.

## Recommended Stack

Website:

- Next.js App Router
- TypeScript
- Clerk authentication, using the current `PROJECT.md` Clerk rules
- Server-side Postgres access only
- Route handlers or server actions for private APIs
- CSS variables or Tailwind tokens for the design system

Database:

- Postgres database `aic`
- `pgvector` for transcript and intelligence vectors
- Existing serving tables:
  - `episodes`
  - `transcript_chunks`
  - `episode_intelligence`
  - `episode_intelligence_items`
  - `episode_intelligence_vectors`
  - `podtrac_episodes`
  - `podtrac_daily_activity`
  - `podtrac_countries`
  - `podtrac_activity_by_country`
  - `podtrac_clients`
  - `podtrac_activity_by_client`

AI services:

- OpenAI `text-embedding-3-small` for query embeddings, matching the stored vectors.
- Silo/Codex endpoint for answer generation by default.
- YouVersion passage retrieval as an explicit server-side tool.
- Full-sermon retrieval as an explicit server-side tool.

## Information Architecture

### Private Owner Console

Primary navigation:

- Overview
- Stats
- Episodes
- Intelligence
- RAG Chat
- Content Studio
- Pipeline
- Settings

#### Overview

Goal: show the owner what changed and what needs attention.

Expected modules:

- Current reporting window and total downloads
- Weekly trend
- Top episodes
- Recent uploads or newly indexed episodes
- RAG corpus coverage
- Pipeline health
- Unmatched or failed records

Design notes:

- Use real operational metrics only.
- Do not use fake KPIs or decorative dashboard cards.
- Surface warnings clearly, such as unmatched Podtrac episodes or failed intelligence rows.

#### Stats

Goal: replace the static Podtrac report with interactive reporting.

Views:

- Downloads over time
- Top episodes
- Episode detail stats
- Country breakdown
- Client/app breakdown
- Date range comparison

Important limitation:

- The current Podtrac database does not contain exact episode by country data. If shown, it must be labeled as estimated or omitted until a true cross-tab import exists.

#### Episodes

Goal: provide a canonical episode browser tied to transcripts, stats, and intelligence.

Features:

- Search by title, scripture, speaker, guest, topic, story, book, person, organization, and date.
- Filter by episode type, publish range, transcript status, vector status, and Podtrac link status.
- Episode detail page with:
  - metadata
  - Podtrac stats
  - executive summary
  - long summary
  - transcript
  - scripture references
  - stories and sermon illustrations
  - interviews, books, people, places, and organizations
  - source chunks and timestamps

#### Intelligence

Goal: inspect and improve structured episode intelligence.

Views:

- Stories and sermon illustrations
- Scripture references
- Interviews and guests
- People, books, organizations, places
- Topics and themes
- Failed or extractive-only summaries

Actions:

- Open source episode
- Open exact transcript location
- Mark needs review
- Queue Codex upgrade for local-extractive rows
- Export selected items

#### RAG Chat

Goal: source-backed conversation with the corpus.

Required behaviors:

- Show retrieved sources before or beside the answer.
- Show whether the answer used semantic vectors, intelligence vectors, corpus discovery, full-sermon retrieval, or Bible passage retrieval.
- Let the user expand full source context.
- Support long-form sermon/article requests with full gathered context.
- Support TTS-safe output mode for generated sermons and articles.
- Preserve request/response logs server-side with secrets redacted.

Interface:

- Chat thread centered on the task.
- Right-side source panel on desktop.
- Collapsible source drawer on mobile.
- Model/provider status visible but not noisy.
- Clear error states for Silo/Codex failures, timeouts, and incomplete streams.

#### Content Studio

Goal: create new source-backed material from Pastor Wood's corpus and scripture text.

Workflows:

- Sermon draft
- Article draft
- Bible study plan
- Devotional series
- Social/email excerpt
- TTS-safe manuscript

Controls:

- Passage selector
- Source emphasis: sermons, interviews, stories, scripture references, full episodes
- Output length
- Tone and format
- TTS-safe toggle
- Citation/source visibility toggle

Important guardrail:

- Generated content should not pretend to be a verbatim Pastor Wood sermon. Label it as newly generated content informed by Pastor Wood's corpus and selected sources.

#### Pipeline

Goal: make ingestion and AI processing auditable.

Views:

- Transcript coverage
- Speech vector coverage
- Episode intelligence coverage
- Intelligence vector coverage
- OpenAI batch status
- Codex enrichment status
- Podtrac sync status
- Unmatched Podtrac episodes
- Recent errors and retryable jobs

Actions:

- Run sync checks
- Queue next batch
- Retry failed rows
- Download or inspect logs

#### Settings

Goal: keep operations secure and explicit.

Areas:

- Users and roles
- Provider configuration status, without displaying secrets
- Public content rules
- Prompt templates
- Retrieval defaults
- Audit log

### Public Website

Primary navigation:

- Episodes
- Topics
- Scripture
- About

Pages:

- Episode listing
- Episode detail page
- Topic page
- Scripture reference page
- Search results

Public episode detail should include:

- Title and publish date
- Audio link when available
- Executive summary
- Scripture references
- Topics
- Transcript if approved for public display
- Related episodes

Public site should not expose:

- Private Podtrac metrics
- Owner RAG chat logs
- Internal pipeline status
- Raw prompts or provider details
- Unreviewed generated content

## Data And API Plan

Use Postgres as the source for website reads.

Suggested API/query modules:

- `episodes`: list, detail, filters, transcript fetch
- `stats`: date ranges, top episodes, country/client breakdowns
- `intelligence`: structured items, summaries, search facets
- `rag`: retrieval, source gathering, answer generation
- `tools`: Bible passage retrieval, full sermon retrieval, corpus discovery
- `pipeline`: coverage counts, batch/job status, error summaries
- `admin`: settings, users, audit

Keep retrieval lanes separate:

- Raw transcript vectors for direct semantic evidence.
- Intelligence vectors for summaries, stories, topics, and structured facts.
- SQL/full-text search for corpus-wide counts and lists.
- Full episode retrieval only when needed for long context or style grounding.
- Bible retrieval only when the user asks for scripture content or a passage is detected.

## Security Plan

Authentication:

- Clerk for private app auth.
- Public pages should not require auth.

Authorization:

- `owner`: full access.
- `editor`: content studio, episode intelligence, public content review.
- `viewer`: read-only private dashboard and RAG.
- `public`: approved public pages only.

Database:

- Keep DB credentials server-side only.
- Do not expose direct database access to the browser.
- Use read-only public query paths where possible.
- Add audit logs for private RAG/chat/content generation requests.

Secrets:

- Never render API keys in UI.
- Logs must redact authorization headers and session tokens.
- Provider status can show configured/not configured, never the secret value.

## Build Phases

### Phase 0: Product And Design Foundation

Deliverables:

- `PRODUCT.md`
- `DESIGN.md`
- App route map
- Shared UI tokens
- Component inventory

Done when:

- Product register is documented as product UI.
- Private and public audience boundaries are explicit.
- Design tokens and component behavior are ready for implementation.

### Phase 1: App Shell, Auth, And Database Access

Deliverables:

- Next.js App Router project in the `aic` repo.
- Clerk wired according to `PROJECT.md`.
- Secure server-side Postgres connection.
- Private layout with sidebar and top utility area.
- Public layout shell.

Done when:

- Signed-in user can access the private console.
- Signed-out user can access public pages only.
- A private health page can read Postgres counts.

### Phase 2: Private Overview And Stats

Deliverables:

- Overview page.
- Stats page.
- Date range controls.
- Top episodes table.
- Country/client breakdowns.

Done when:

- The current Podtrac totals match the verified `118626` clean-window total.
- Stats can join Podtrac rows to canonical episodes through `track_id`.
- Unmatched Podtrac records are visible.

### Phase 3: Episode Browser

Deliverables:

- Episode list with filters.
- Episode detail page.
- Transcript viewer.
- Intelligence sections.
- Stats side panel.

Done when:

- A user can open an episode and see transcript, summary, structured intelligence, and Podtrac stats in one place.

### Phase 4: RAG Chat

Deliverables:

- Private chat UI.
- Source panel.
- Retrieval trace.
- Bible passage tool integration.
- Full-sermon tool integration.
- Error and timeout handling.

Done when:

- The app can answer with cited sources from transcript and intelligence vectors.
- Long-form requests can pull full sermon context and Bible passages.
- The UI explains when a result is partial, estimated, or failed.

### Phase 5: Content Studio

Deliverables:

- Guided forms for sermons, articles, Bible studies, devotionals, and TTS-safe manuscripts.
- Source selection controls.
- Draft preview.
- Source review panel.
- Export/copy actions.

Done when:

- A user can generate a long-form draft from scripture plus selected corpus evidence.
- TTS-safe formatting avoids markdown, verse-by-verse announcements, bracket references, and awkward punctuation.

### Phase 6: Pipeline Console

Deliverables:

- Coverage dashboard.
- Batch/job status views.
- Failed/retryable rows.
- Podtrac sync history.
- Intelligence upgrade progress.

Done when:

- The owner can see whether transcript, vector, intelligence, and Podtrac data are current.

### Phase 7: Public Website

Deliverables:

- Public episode index.
- Public episode detail.
- Topic and scripture pages.
- Public search.
- SEO metadata.

Done when:

- Public visitors can browse approved podcast content without seeing private metrics, prompts, logs, or pipeline internals.

## MVP Recommendation

Build the private site first:

1. App shell, Clerk, and Postgres health.
2. Overview and Stats.
3. Episode Browser.
4. RAG Chat.
5. Content Studio.

Then build the public site once the episode detail model and public-content rules are proven.

This order is better because the private console validates the data model, joins, source display, and retrieval behavior before exposing anything publicly.

## Open Decisions

- Hosting target for the Next.js app.
- Public transcript policy: all transcripts, reviewed transcripts only, or summaries only at first.
- Whether public search should use vectors or only keyword/full-text search.
- Exact roles and who can publish public-facing episode pages.
- Whether Podtrac weekly import should be triggered from the web UI or remain a server automation only.
