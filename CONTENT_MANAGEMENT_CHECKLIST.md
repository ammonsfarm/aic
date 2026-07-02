# Pastor Wood / AIC Content Management Checklist

Last updated: 2026-07-01
Maintained in: `/Users/van/firebase/aic/CONTENT_MANAGEMENT_CHECKLIST.md`
Related plan: `/Users/van/firebase/aic/CONTENT_MANAGEMENT_PROJECT_PLAN.md`

## How to maintain this file

Use this checklist as the running project tracker. Update it as work is completed, decisions are made, blockers are found, or scope changes.

Conventions:

- `[ ]` Not started
- `[x]` Complete
- `[~]` In progress or partially complete
- Add dated notes under the relevant section instead of replacing history.
- Add blockers under `Active blockers / risks` until resolved.
- Add final validation commands and results under the relevant phase before marking a phase complete.

## Current checkpoint

- [x] Unified app source identified: `/Users/van/firebase/aic`
- [x] Related podcast/data workspace identified: `/Users/van/firebase/aic_podcast`
- [x] Public Pastor Wood site shell exists in the AIC app
- [x] Protected AIC research/admin area exists
- [x] `/content` protected portal shell created
- [x] `Content` navigation item added to protected nav
- [x] Long-form project plan created: `CONTENT_MANAGEMENT_PROJECT_PLAN.md`
- [x] Living checklist created: `CONTENT_MANAGEMENT_CHECKLIST.md`
- [x] Phase 0 confirmed by Michael on 2026-07-01
- [x] Checklist committed and pushed
- [x] Checklist deployed to `farm:/mnt/storage/aic`

Notes:

- 2026-07-01: Initial checklist created from the project plan and current implementation state.
- 2026-07-01: Existing uncommitted Pastor Wood logo/site work was present before this checklist was created. Do not overwrite unrelated work.
- 2026-07-01: Michael confirmed Phase 0 and approved proceeding to Phase 1.

## Active blockers / risks

- [x] Decide whether content managers can publish directly or require reviewer/admin approval.
  - Decision: only one person will manage content for now. No approval workflow is needed for the first release.
- [x] Decide final long-term MP3 storage location.
  - Decision: use MinIO for now. Leave the design open for a future migration to R2 or another object store.
- [x] Decide whether imported historical WordPress posts should auto-publish or enter review.
  - Decision: auto-publish imported historical WordPress posts.
- [x] Decide whether old `www.pastorwood.org` will point to this app or whether `pastorwood.ammonsfarm.org` remains the replacement host.
  - Decision: `www.pastorwood.org` will eventually point to this app.
- [x] Decide whether existing protected research routes remain top-level or are grouped under a new nav section.
  - Decision: existing protected research routes remain protected as-is for now.
- [x] Confirm Mailchimp strategy.
  - Decision: archive newsletters locally first; add Mailchimp sync/send later as explicit audited actions.

No active blockers are currently recorded from the initial decision list.

## Decision log

| Date | Decision | Rationale | Status |
|---|---|---|---|
| 2026-07-01 | Use `/content` for CMS/editorial work | Keeps content management separate from public site and system admin | Accepted |
| 2026-07-01 | Keep `/admin` for system administration | Avoids mixing content publishing with user/security/API settings | Accepted |
| 2026-07-01 | Keep public site routes at root | Public replacement site should not require visitors to understand app internals | Accepted |
| 2026-07-01 | Do not require approvals for content publishing in the first release | Only one person will manage content for now | Accepted |
| 2026-07-01 | Use MinIO as the initial MP3 storage location | Matches current storage direction while preserving future R2 migration option | Accepted |
| 2026-07-01 | Auto-publish imported historical WordPress posts | Historical content is treated as migrated public content, not new draft content | Accepted |
| 2026-07-01 | Eventually route `www.pastorwood.org` to this app | This app is intended to replace the old Pastor Wood site | Accepted |
| 2026-07-01 | Use `aic.ammonsfarm.org` as the single public site host | Removes the host split; `/content/*` remains the private CMS area | Accepted |
| 2026-07-01 | Keep existing research routes protected as-is for now | Avoids unnecessary route churn while CMS work begins | Accepted |
| 2026-07-01 | Archive newsletters locally first, then add explicit Mailchimp sync/send later | Prevents accidental emails and keeps Mailchimp send explicit | Accepted |

## Phase 0: Baseline and planning

Goal: establish the working structure and shared project documents.

- [x] Open and inspect `/Users/van/firebase/aic`
- [x] Open and inspect `/Users/van/firebase/aic_podcast`
- [x] Identify public site directory path
- [x] Identify protected AIC/admin directory path
- [x] Identify public Pastor Wood host routing
- [x] Create `/content` portal page
- [x] Add `/content` to protected navigation
- [x] Run lint after `/content` route creation
- [x] Run build after `/content` route creation
- [x] Create long-form project plan markdown
- [x] Create living checklist markdown
- [x] Commit Phase 0 files
- [x] Push Phase 0 files
- [x] Deploy Phase 0 to farm
- [x] Verify `/content` is protected in production

Validation notes:

- 2026-07-01: `npm run lint` passed with existing `<img>` warnings in `components/pastor-wood-site.tsx`.
- 2026-07-01: `npm run build` passed and showed `/content` as a dynamic route.

Files involved:

- `CONTENT_MANAGEMENT_PROJECT_PLAN.md`
- `CONTENT_MANAGEMENT_CHECKLIST.md`
- `app/(private)/content/page.tsx`
- `lib/navigation.ts`

## Phase 1: Protected route and role foundation

Goal: prepare the protected portal for real CMS screens and separate editorial roles from system administration.

### Routes

- [x] Create `/content/pages` placeholder page
- [x] Create `/content/pages/[pageId]` placeholder page
- [x] Create `/content/posts` placeholder page
- [x] Create `/content/posts/new` placeholder page
- [x] Create `/content/posts/[postId]` placeholder page
- [x] Create `/content/podcast` placeholder page
- [x] Create `/content/podcast/new` placeholder page
- [x] Create `/content/podcast/[episodeId]` placeholder page
- [x] Create `/content/newsletters` placeholder page
- [x] Create `/content/newsletters/new` placeholder page
- [x] Create `/content/newsletters/[newsletterId]` placeholder page
- [x] Create `/content/media` placeholder page
- [x] Create `/content/media/[assetId]` placeholder page
- [x] Create `/content/workflow` placeholder page
- [x] Confirm all `/content/*` routes are protected by Clerk middleware/layout
- [x] Confirm public routes remain public
- [x] Confirm `/admin` remains admin-only

### Roles and permissions

- [x] Expand `AicRole` beyond `User` and `Admin`
- [x] Add `Content Manager` role
- [x] Add `Research User` role
- [x] Add `Read Only` role if needed
- [x] Defer `Reviewer` role unless a separate approval workflow is needed later
- [x] Add helper: `requireContentManager()`
- [x] Add helper: `requireContentManagerOrAdmin()`
- [x] Add helper: `requireResearchUser()`
- [x] Update role normalization logic
- [x] Update admin user-role UI to assign new roles
- [x] Add role descriptions in `/admin`
- [x] Add tests or validation for protected role behavior

### Navigation

- [x] Decide whether existing research routes remain top-level or group under `Research`
- [x] Add clear nav separation: Content, Research, Admin
- [x] Hide `/admin` from non-admin users
- [~] Hide publish actions from users without publish permission

Validation commands:

```bash
npm run lint
npm run build
```

Phase 1 notes:

- 2026-07-01: Added protected placeholder routes for pages, posts, podcast uploads, newsletters, media, and workflow.
- 2026-07-01: Added nested `/content` layout guard using `requireContentManagerOrAdmin()`.
- 2026-07-01: Expanded role model to include `Content Manager`, `Research User`, and `Read Only`; deferred `Reviewer` role.
- 2026-07-01: Added migration `postgres/migrations/011_aic_content_roles.sql` for expanded content roles.
- 2026-07-01: Updated admin role assignment UI to show the expanded role list.
- 2026-07-01: Updated protected nav filtering so Content is shown only to Admin and Content Manager roles.
- 2026-07-01: `npm run lint` passed with existing `<img>` warnings in `components/pastor-wood-site.tsx`.
- 2026-07-01: `npm run build` passed and listed the new `/content/*` routes.

## Phase 2: CMS database schema and server read layer

Goal: create database-backed content models before replacing hardcoded public content.

### Migrations

- [x] Create migration for `content_pages`
- [x] Create migration for `content_page_revisions`
- [x] Create migration for `content_posts`
- [x] Create migration for `content_post_revisions`
- [x] Create migration for `content_podcast_uploads`
- [x] Create migration for `content_newsletters`
- [x] Create migration for `content_media_assets`
- [x] Create migration for `content_workflow_events`
- [x] Create migration for `content_audit_log`
- [x] Add indexes for slug lookup
- [x] Add indexes for status/publish date filtering
- [x] Add foreign keys for published revision references
- [x] Add constraints for status values
- [~] Add constraints for unique public slugs where needed

### Data access modules

- [x] Add `lib/content-pages.ts`
- [x] Add `lib/content-posts.ts`
- [x] Add `lib/content-podcast.ts`
- [x] Add `lib/content-newsletters.ts`
- [x] Add `lib/content-media.ts`
- [x] Add `lib/content-workflow.ts`
- [x] Add `lib/content-audit.ts`
- [x] Add published-only read helpers for public rendering
- [~] Add draft/revision read helpers for protected editing

### Seed/import foundation

- [x] Create seed script for current public page content
- [x] Seed Home page
- [x] Seed About Pastor Wood page
- [x] Seed Radio landing page
- [x] Seed Contact page
- [x] Seed Donate page
- [x] Seed Endorsements page
- [x] Seed Board Members page
- [x] Seed Privacy / Terms page
- [x] Preserve current hardcoded content during seed validation

Validation commands:

```bash
npm run lint
npm run build
# local migration command if available
# farm migration command after deploy if approved
```

Phase 2 notes:

- 2026-07-01: Added migration `postgres/migrations/012_content_management_core.sql` for core CMS tables and indexes.
- 2026-07-01: Added read modules for pages, posts, podcast uploads, newsletters, media, workflow, and audit history.
- 2026-07-01: Added `scripts/seed_content_pages.sql` as a page inventory seed. It creates Draft inventory rows and initial Draft revisions and does not affect current route rendering.
- 2026-07-01: `npm exec eslint .` passed with existing `<img>` warnings in `components/pastor-wood-site.tsx`.
- 2026-07-01: `npm run build` passed.
- 2026-07-01: Committed and pushed as `948fdaa Add CMS schema and read layer`.
- 2026-07-01: Deployed to `farm:/mnt/storage/aic`; migration `012_content_management_core.sql` applied and then verified as skipped on rerun.
- 2026-07-01: Verified `aic-web.service` active and unauthenticated `/content` still redirects to `/login?redirect_url=%2Fcontent`.
- 2026-07-01: Expanded and ran `scripts/seed_content_pages.sql` on farm. Verification returned 12 `content_pages` rows and 12 `content_page_revisions` rows.

## Phase 3: Public rendering from CMS

Goal: replace hardcoded public page content with published CMS records while preserving route URLs and current visual design.

### Published-only public rendering

- [x] Build generic published content fetcher
- [~] Build public page renderer component
- [x] Add safe fallback for missing published content
- [x] Ensure draft content is never returned by public fetchers
- [~] Ensure scheduled content is hidden until scheduled date/time
- [ ] Add preview route or preview mode requiring auth

### Convert public pages

- [x] Convert `/about-pastor-wood` to CMS-backed rendering
- [x] Convert `/contact` to CMS-backed rendering
- [ ] Convert `/donate` to CMS-backed rendering
- [ ] Convert `/endorsements` to CMS-backed rendering
- [ ] Convert `/board-members` to CMS-backed rendering
- [ ] Convert `/privacy-terms-conditions` to CMS-backed rendering
- [ ] Convert `/bible-study` to CMS-backed rendering
- [ ] Convert `/written-resources` to CMS-backed rendering
- [ ] Convert `/radio` landing page to CMS-backed rendering
- [ ] Convert `/` Pastor Wood host rendering to CMS-backed rendering

### Public site validation

- [x] Confirm public home loads without login
- [ ] Confirm public content matches or improves current visual design
- [ ] Confirm navigation works on desktop
- [ ] Confirm navigation works on mobile
- [ ] Confirm donation links work
- [ ] Confirm contact links work
- [ ] Confirm privacy links work
- [ ] Confirm no protected links are exposed to ordinary visitors

Validation commands:

```bash
npm run lint
npm run build
curl -LfsS --max-time 20 https://pastorwood.ammonsfarm.org/ | grep -F 'Welcome to Abiding in Christ'
```

Phase 3 notes:

- 2026-07-01: Converted `/about-pastor-wood` to read the published CMS hero title/body through `getPublishedContentPage("about-pastor-wood")`.
- 2026-07-01: Kept existing static body content as the page shell/fallback so the public page does not break if CMS lookup fails.
- 2026-07-01: Updated `scripts/seed_content_pages.sql` to publish the seeded About page revision while leaving other seeded pages as Draft inventory.
- 2026-07-01: Local `npm exec eslint .` passed with existing `<img>` warnings in `components/pastor-wood-site.tsx`.
- 2026-07-01: Local `npm run build` passed after making `/about-pastor-wood` dynamic.
- 2026-07-01: Committed, pushed, and deployed as `39e97d4 Render About page hero from CMS`.
- 2026-07-01: Reran `scripts/seed_content_pages.sql` on farm so `about-pastor-wood` and its first revision are `Published`.
- 2026-07-01: Verified the Pastor Wood host `/about-pastor-wood` route returns 200 and contains the expected hero text.
- 2026-07-01: Updated architecture so the public site is no longer selected by host. `/` and public Pastor Wood routes are public on normal hosts such as `localhost`, LAN IP, and `aic.ammonsfarm.org`; `/content/*` remains login-protected.
- 2026-07-01: Committed and deployed `6d2c91a Use optimized transparent nav logo`; the nav now uses an 18K transparent WebP logo.
- 2026-07-01: Committed and deployed `89aa271 Render Contact page hero from CMS`; reran the CMS seed so `contact` and its first revision are `Published`.
- 2026-07-01: Verified `/contact` returns `200`, `/content` returns `307`, and `aic-web.service` is active on farm.

## Phase 4: Page and post editors

Goal: allow content managers to edit public pages and posts without code changes.

### Page list and editor

- [ ] Build `/content/pages` list
- [ ] Add filters by status and page type
- [ ] Add page detail/editor screen
- [ ] Add field: title
- [ ] Add field: slug
- [ ] Add field: SEO title
- [ ] Add field: SEO description
- [ ] Add field: hero title
- [ ] Add field: hero body
- [ ] Add structured body content editor
- [ ] Add CTA/link editor
- [ ] Add image/media picker
- [ ] Add save draft action
- [ ] Add direct publish action
- [ ] Add schedule action
- [ ] Add unpublish/archive action
- [ ] Add revision history view
- [ ] Add rollback or restore revision action

### Post list and editor

- [ ] Build `/content/posts` list
- [ ] Add filters by status, type, publish date, and tags
- [ ] Add post detail/editor screen
- [ ] Add field: title
- [ ] Add field: slug
- [ ] Add field: author
- [ ] Add field: publish date
- [ ] Add field: excerpt
- [ ] Add field: scripture references
- [ ] Add field: topic tags
- [ ] Add rich body editor
- [ ] Add related episodes/writings selector
- [ ] Add SEO fields
- [ ] Add draft/schedule/publish actions
- [ ] Add revision history

### Audit and workflow

- [ ] Audit page draft save
- [ ] Audit page publish
- [ ] Audit page archive
- [ ] Audit post draft save
- [ ] Audit post publish
- [ ] Audit post archive
- [ ] Record workflow state changes
- [ ] Show workflow timeline in editor

Validation commands:

```bash
npm run lint
npm run build
```

Phase 4 notes:

- Add editor implementation notes here.

## Phase 5: Media library

Goal: provide a managed place for public images, PDFs, downloads, and audio files.

### Storage strategy

- [ ] Decide media storage provider
- [ ] Define public asset URL strategy
- [ ] Define private/draft asset strategy
- [ ] Define max file size limits
- [ ] Define accepted MIME types
- [ ] Define image resizing or optimization approach
- [ ] Define audio metadata extraction approach

### Media API and UI

- [ ] Build `GET /api/content/media`
- [ ] Build `POST /api/content/media`
- [ ] Build `GET /api/content/media/[id]`
- [ ] Build `PATCH /api/content/media/[id]`
- [ ] Build delete/archive media action
- [ ] Build `/content/media` grid/list
- [ ] Build `/content/media/[assetId]` detail screen
- [ ] Add upload UI
- [ ] Add alt text editor
- [ ] Add caption editor
- [ ] Add attribution editor
- [ ] Add usage tracking or usage notes
- [ ] Add media picker component for page/post editors

### Media validation

- [ ] Upload image asset
- [ ] Use image asset in a page draft
- [ ] Publish page using image asset
- [ ] Upload PDF or document asset if supported
- [ ] Upload MP3 asset if supported in this phase
- [ ] Confirm private/draft assets do not leak publicly

Validation commands:

```bash
npm run lint
npm run build
```

Phase 5 notes:

- Add storage decision and upload validation results here.

## Phase 6: Podcast upload and processing handoff

Goal: make new MP3 uploads manageable through `/content` while leaving long-running processing to background/server jobs.

### Podcast upload UI

- [ ] Build `/content/podcast` list
- [ ] Build `/content/podcast/new` upload form
- [ ] Build `/content/podcast/[episodeId]` editor
- [ ] Add MP3 upload field
- [ ] Add title field
- [ ] Add slug field
- [ ] Add program date field
- [ ] Add description field
- [ ] Add category/series field
- [ ] Add scripture references field
- [ ] Add guest names field
- [ ] Add public visibility field
- [ ] Add audio preview
- [ ] Add save draft action
- [ ] Add direct publish action
- [ ] Add schedule action

### Processing handoff

- [ ] Define processing request table or reuse existing job model
- [ ] Add transcript job request action
- [ ] Add intelligence job request action
- [ ] Add vector job request action
- [ ] Show `Not Requested` status
- [ ] Show `Queued` status
- [ ] Show `Running` status
- [ ] Show `Completed` status
- [ ] Show `Failed` status with retry
- [ ] Ensure processing is not run inside web request
- [ ] Ensure background jobs can find uploaded audio

### Public archive integration

- [ ] Link published podcast upload to public episode record
- [ ] Show uploaded/published MP3 in public radio/archive pages
- [ ] Keep draft podcast uploads hidden from public pages
- [ ] Add validation for public audio playback

Validation commands:

```bash
npm run lint
npm run build
```

Phase 6 notes:

- Add upload and processing validation notes here.

## Phase 7: Newsletter archive and Mailchimp sync

Goal: manage newsletter archive entries locally first, then optionally sync/send through Mailchimp by explicit action.

### Newsletter archive

- [ ] Build `/content/newsletters` list
- [ ] Build `/content/newsletters/new` editor
- [ ] Build `/content/newsletters/[newsletterId]` editor
- [ ] Add title field
- [ ] Add subject line field
- [ ] Add preview text field
- [ ] Add body editor
- [ ] Add archive visibility field
- [ ] Add related posts/episodes selector
- [ ] Add save draft action
- [ ] Add direct publish to website archive action
- [ ] Add schedule action
- [ ] Add public newsletter archive route if needed
- [ ] Confirm website publish does not send email

### Mailchimp integration

- [ ] Add Mailchimp integration settings under `/admin/integrations`
- [ ] Store Mailchimp API config securely
- [ ] Add campaign ID field
- [ ] Add explicit `Create/Update Mailchimp Campaign` action
- [ ] Add explicit `Schedule Mailchimp Campaign` action if needed
- [ ] Add explicit `Send Mailchimp Campaign` action only with confirmation
- [ ] Add campaign status sync
- [ ] Add audit log for all Mailchimp actions
- [ ] Add error handling for Mailchimp API failures

Validation commands:

```bash
npm run lint
npm run build
```

Phase 7 notes:

- Add Mailchimp account/API decisions here.

## Phase 8: Old site migration and cutover

Goal: prepare this app to replace the older `www.pastorwood.org` site safely.

### Content inventory

- [ ] Inventory old home page
- [ ] Inventory old about page
- [ ] Inventory old radio archive
- [ ] Inventory old devotional posts
- [ ] Inventory old written resources
- [ ] Inventory old board page
- [ ] Inventory old endorsements page
- [ ] Inventory old contact page
- [ ] Inventory old donate/donor dashboard behavior
- [ ] Inventory old privacy/terms page
- [ ] Inventory old media/assets that must be retained

### Import and parity

- [ ] Import historical devotional posts
- [ ] Import historical written resources
- [ ] Preserve original source URLs
- [ ] Generate clean new slugs
- [ ] Store normalized plain text
- [ ] Store original HTML where useful
- [ ] Review bulk imported content
- [ ] Publish approved imported content
- [ ] Add redirects for important old URLs
- [ ] Validate SEO titles/descriptions

### Domain/cutover readiness

- [ ] Confirm all critical pages have replacements
- [ ] Confirm public pages do not require login
- [ ] Confirm protected pages require login
- [ ] Confirm donation links work
- [ ] Confirm contact form or contact links work
- [ ] Confirm analytics approach
- [ ] Confirm Cloudflare public hostname route
- [ ] Confirm old domain cutover strategy
- [ ] Confirm rollback strategy
- [ ] Final pre-cutover build passes
- [ ] Final production smoke test passes

Validation commands:

```bash
npm run lint
npm run build
curl -LfsS --max-time 20 https://pastorwood.ammonsfarm.org/ | grep -F 'Welcome to Abiding in Christ'
```

Phase 8 notes:

- Add old-site inventory and cutover notes here.

## Phase 9: Production deployment and verification

Goal: deploy the completed work safely and verify both public and protected behavior.

### Pre-deploy

- [ ] Confirm git status contains only intended files
- [ ] Run lint
- [ ] Run build
- [ ] Review migration files
- [ ] Confirm server deploy path
- [ ] Confirm no secrets are printed or committed
- [ ] Commit changes
- [ ] Push changes to `main`

### Deploy

- [ ] Run `npm run deploy:farm`
- [ ] Confirm server checkout updated
- [ ] Confirm migrations applied
- [ ] Confirm app built on server
- [ ] Confirm `aic-web.service` restarted
- [ ] Confirm service is active

### Post-deploy smoke tests

- [ ] Public home loads
- [ ] Public Pastor Wood host renders correct public site
- [ ] `/login` loads
- [ ] `/content` requires login
- [ ] `/admin` requires admin
- [ ] `/content` loads for allowed user
- [ ] `/admin` loads for admin
- [ ] Public routes do not expose draft content
- [ ] Published page renders from CMS
- [ ] Public audio route works if relevant
- [ ] Mailchimp actions disabled or guarded unless configured

Validation commands:

```bash
ssh farm 'cd /mnt/storage/aic && git rev-parse --short HEAD && systemctl is-active aic-web.service && curl -fsS http://127.0.0.1:8087/login >/dev/null && echo ok'
curl -LfsS --max-time 20 https://pastorwood.ammonsfarm.org/ | grep -F 'Welcome to Abiding in Christ'
```

Deployment notes:

- Add production deploy notes here.

## Running notes

### 2026-07-01

- Created `/content` portal shell.
- Added protected nav entry for Content.
- Created `CONTENT_MANAGEMENT_PROJECT_PLAN.md`.
- Created `CONTENT_MANAGEMENT_CHECKLIST.md`.
- Recorded initial project decisions: no approvals for first release, MinIO for MP3 storage, auto-publish historical imports, eventual `www.pastorwood.org` cutover, protected research routes remain as-is, and local newsletter archive before Mailchimp sync/send.
- Michael confirmed Phase 0 and approved proceeding to Phase 1.
- Started Phase 1 and added protected placeholder routes, role expansion, and navigation filtering.
- Validation: `npm run lint` passed with existing warnings; `npm run build` passed.
- Started Phase 2 and added the schema/read-layer foundation.
- Committed, pushed, and deployed Phase 2 as `948fdaa Add CMS schema and read layer`.
- Verified migration `012_content_management_core.sql` was applied on farm and service remained active.
- Expanded and ran the page inventory seed on farm; verified 12 pages and 12 first revisions.
- Started Phase 3 by converting `/about-pastor-wood` to use the published CMS hero title/body with static fallback content.
- Deployed Phase 3 About conversion as `39e97d4`; verified the Pastor Wood host route renders the CMS-backed hero.
- Committed CMS foundation locally as `0b0ea95 Add content management portal foundation`.
- Pushed `0b0ea95` to `origin/main`.
- Deployed to `farm:/mnt/storage/aic`; `aic-web.service` restarted and reported active.
- Verified unauthenticated `/content` returns `307 Temporary Redirect` to `/login?redirect_url=%2Fcontent`.

## Change log

| Date | Change | Files |
|---|---|---|
| 2026-07-01 | Created living checklist | `CONTENT_MANAGEMENT_CHECKLIST.md` |
| 2026-07-01 | Created project plan | `CONTENT_MANAGEMENT_PROJECT_PLAN.md` |
| 2026-07-01 | Added protected content portal shell | `app/(private)/content/page.tsx` |
| 2026-07-01 | Added Content nav section | `lib/navigation.ts` |
| 2026-07-01 | Confirmed Phase 0 and started Phase 1 | `CONTENT_MANAGEMENT_CHECKLIST.md` |
| 2026-07-01 | Added CMS role support and placeholder routes | `lib/rbac.ts`, `components/admin-console.tsx`, `app/(private)/content/*` |

## Follow-up prompts

Use these prompts to continue work in clean steps.

### Phase 1 prompt

```text
Continue the Pastor Wood / AIC CMS project. Read CONTENT_MANAGEMENT_PROJECT_PLAN.md and CONTENT_MANAGEMENT_CHECKLIST.md first. Complete Phase 1: add protected placeholder routes under /content, expand RBAC for Content Manager, and update navigation without changing public site behavior. Do not add an approval workflow for the first release. Update the checklist with notes and validation results.
```

### Phase 2 prompt

```text
Continue the Pastor Wood / AIC CMS project. Read CONTENT_MANAGEMENT_PROJECT_PLAN.md and CONTENT_MANAGEMENT_CHECKLIST.md first. Complete Phase 2: add CMS database migrations and server-side content read modules. Do not convert public rendering yet. Update the checklist with migration IDs, validation commands, and open issues.
```

### Phase 3 prompt

```text
Continue the Pastor Wood / AIC CMS project. Read CONTENT_MANAGEMENT_PROJECT_PLAN.md and CONTENT_MANAGEMENT_CHECKLIST.md first. Complete Phase 3 by converting /about-pastor-wood to published CMS-backed rendering with an authenticated preview path. Update the checklist with validation results.
```
