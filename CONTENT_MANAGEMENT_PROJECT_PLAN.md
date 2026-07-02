# Pastor Wood / AIC Content Management Project Plan

Date: 2026-07-01
Repo: `/Users/van/firebase/aic`
Server deploy path: `farm:/mnt/storage/aic`
Primary public host: `https://pastorwood.ammonsfarm.org/`
Original site being replaced: `https://www.pastorwood.org/`

## 1. Purpose

Build one unified Next.js application that serves both:

1. A public Pastor Wood website that can replace the older WordPress-style site currently hosted at `https://www.pastorwood.org/`.
2. A protected content and research portal for managing public site content, sermon and podcast material, newsletters, media, and the existing AIC research tools.

The public website should be simple, fast, ministry-focused, and published-content-only.

The protected area should become the working system for content managers, administrators, and research users.

## 2. Target Information Architecture

### Public site

Public routes remain at the root of the site and render only published content.

```text
/
/about-pastor-wood
/radio
/radio/[slug]
/bible-study
/written-resources
/writings
/writings/[slug]
/episodes
/episodes/[trackId]
/contact
/donate
/donor-dashboard
/endorsements
/board-members
/privacy-terms-conditions
/privacy
```

Public pages must never expose draft content, admin-only data, RAG internals, pipeline logs, raw prompts, API keys, user data, or unapproved generated material.

### Protected content portal

The CMS/editorial workspace lives under `/content`.

```text
/content
/content/pages
/content/pages/[pageId]
/content/posts
/content/posts/new
/content/posts/[postId]
/content/podcast
/content/podcast/new
/content/podcast/[episodeId]
/content/newsletters
/content/newsletters/new
/content/newsletters/[newsletterId]
/content/media
/content/media/[assetId]
/content/workflow
```

This area is for content managers. It should eventually include CRUD screens, previews, revision history, scheduling, publish controls, media management, and podcast upload workflow.

### Protected admin area

System administration remains under `/admin`.

```text
/admin
/admin/users
/admin/roles
/admin/settings
/admin/integrations
/admin/pipeline
/admin/audit
```

`/admin` should be reserved for system settings, user and role management, API/integration configuration, pipeline administration, RAG settings, and audit review.

### Existing protected AIC research console

The current AIC tools may remain as protected research/productivity routes.

```text
/overview
/archive
/sources
/research
/compose
/pipeline
/stats
/podcast
```

Long term, these can either remain separate top-level protected routes or be grouped visually under a `Research` navigation section. They should not be mixed into the public site.

## 3. Route Ownership

| Area | Route | Audience | Purpose |
|---|---|---|---|
| Public website | `/` and public page routes | Visitors | Published Pastor Wood ministry content |
| Content portal | `/content/*` | Content managers | Edit, schedule, and publish site content |
| Admin | `/admin/*` | Administrators | Users, roles, settings, integrations, audits |
| Research console | `/archive`, `/research`, `/compose`, etc. | Internal users | Sermon corpus, RAG, research, drafting |
| API | `/api/content/*`, `/api/admin/*`, `/api/rag/*` | App only | Data mutation, admin, retrieval, integrations |

## 4. Permissions Model

The current app has `User` and `Admin`. Expand this to separate content publishing from system administration, but keep the first release simple because only one person will manage content.

Recommended first-release roles:

```text
Admin
Content Manager
Research User
Read Only
```

A `Reviewer` role can be added later if the ministry adds a separate review/approval process.

### Admin

Can manage users, roles, API settings, integrations, RAG settings, pipeline settings, audit logs, and all content.

### Content Manager

Can create, edit, upload, schedule, publish, unpublish, and archive content directly. No approval workflow is required for the first release.

### Research User

Can use existing protected AIC sermon, research, compose, archive, and source tools. Cannot publish public site content unless also assigned Content Manager.

### Read Only

Can view internal dashboards and approved internal material only.

## 5. Core Data Model

Add database tables that support a real CMS rather than hardcoded page arrays.

### Content pages

Use this for evergreen site pages such as home, about, contact, donate, endorsements, board, privacy, and radio landing pages.

```text
content_pages
- id
- slug
- title
- page_type
- status
- published_revision_id
- created_by
- updated_by
- created_at
- updated_at
- published_at
- scheduled_for
- archived_at
```

```text
content_page_revisions
- id
- page_id
- revision_number
- title
- seo_title
- seo_description
- hero_title
- hero_body
- body_json
- body_html
- status
- created_by
- created_at
- change_note
```

### Posts and writings

Use this for devotionals, written resources, articles, study posts, and imported Pastor Wood material.

Existing `pastorwood_posts` tables can be retained, but the CMS should either extend them or introduce a normalized `content_posts` layer that can reference imported records.

```text
content_posts
- id
- source_type
- source_post_id
- slug
- title
- excerpt
- body_json
- body_html
- plain_text
- author_name
- publish_date
- status
- visibility
- canonical_url
- seo_title
- seo_description
- created_by
- updated_by
- published_at
- scheduled_for
- created_at
- updated_at
```

```text
content_post_revisions
- id
- post_id
- revision_number
- title
- excerpt
- body_json
- body_html
- plain_text
- status
- created_by
- created_at
- change_note
```

### Podcast and MP3 publishing

Use this for uploaded MP3s and public episode archive management.

```text
content_podcast_uploads
- id
- track_id
- title
- slug
- description
- summary
- scripture_references
- category
- series
- speaker
- guest_names
- publish_date
- status
- audio_asset_id
- duration_seconds
- file_size_bytes
- source_url
- transcript_status
- intelligence_status
- vector_status
- public_episode_id
- created_by
- updated_by
- created_at
- updated_at
- published_at
```

### Newsletters

The site should store newsletter archive entries even if actual sending remains in Mailchimp initially.

```text
content_newsletters
- id
- slug
- title
- subject
- preview_text
- body_json
- body_html
- plain_text
- status
- archive_visibility
- mailchimp_campaign_id
- mailchimp_status
- scheduled_for
- sent_at
- published_at
- created_by
- updated_by
- created_at
- updated_at
```

### Media library

Use object storage for files and Postgres for metadata.

```text
content_media_assets
- id
- asset_type
- filename
- original_filename
- storage_provider
- storage_bucket
- storage_key
- public_url
- mime_type
- file_size_bytes
- width
- height
- duration_seconds
- alt_text
- caption
- attribution
- status
- uploaded_by
- created_at
- updated_at
```

### Workflow and audit

```text
content_workflow_events
- id
- entity_type
- entity_id
- from_status
- to_status
- note
- actor_email
- created_at
```

```text
content_audit_log
- id
- entity_type
- entity_id
- action
- actor_email
- before_json
- after_json
- created_at
```

## 6. Publishing States

Use a simple lifecycle for pages, posts, newsletters, and podcast uploads in the first release.

```text
Draft
Scheduled
Published
Archived
```

Rules:

- Draft content is visible only inside `/content`.
- Scheduled content becomes public only at or after `scheduled_for`.
- Published content is visible on public routes.
- Archived content is hidden from normal public listings but may remain addressable if desired.
- Historical WordPress imports should be auto-published during migration unless a specific import error or content issue is detected.
- A review/approval state can be added later if a separate reviewer joins the workflow.

## 7. Public Rendering Rules

Public pages should read only from published revisions.

For each public page:

1. Resolve route to a content page or content post.
2. Fetch only records where status is `Published` and publication time is valid.
3. Render the published revision, not the working draft.
4. Never render unpublished drafts based on query string, cookie, or accidental route match.
5. Preview mode must require authentication and should use a signed preview token or protected route.

## 8. Content Editing Requirements

### Page editor

Must support:

- Page title
- Slug
- SEO title and description
- Hero title/body
- Structured content sections
- Image selection from media library
- CTA buttons
- Link validation
- Draft save
- Preview
- Direct publish/unpublish
- Revision history

### Post editor

Must support:

- Title
- Slug
- Author
- Publish date
- Excerpt
- Rich body content
- Scripture references
- Topic tags
- Related episodes or writings
- SEO fields
- Draft/schedule/publish workflow
- Revision history

### Podcast upload editor

Must support:

- MP3 upload
- Title
- Slug
- Program date
- Description
- Category/series
- Scripture references
- Guest names
- Public visibility
- Audio preview
- Transcript job status
- Intelligence/vector job status
- Publish controls

### Newsletter editor

Must support:

- Title
- Subject line
- Preview text
- Body content
- Archive visibility
- Optional related posts/episodes
- Mailchimp campaign sync
- Mailchimp send status
- Public archive publish controls

### Media manager

Must support:

- Upload image, audio, PDF, and document files
- Alt text
- Caption
- Attribution
- Public/private flag
- Search/filter
- Replace file safely
- Usage tracking

## 9. API Surface

Add protected content APIs.

```text
GET    /api/content/pages
POST   /api/content/pages
GET    /api/content/pages/[id]
PATCH  /api/content/pages/[id]
POST   /api/content/pages/[id]/revisions
POST   /api/content/pages/[id]/publish
POST   /api/content/pages/[id]/schedule
POST   /api/content/pages/[id]/archive
```

```text
GET    /api/content/posts
POST   /api/content/posts
GET    /api/content/posts/[id]
PATCH  /api/content/posts/[id]
POST   /api/content/posts/[id]/revisions
POST   /api/content/posts/[id]/publish
POST   /api/content/posts/[id]/archive
```

```text
GET    /api/content/podcast
POST   /api/content/podcast
GET    /api/content/podcast/[id]
PATCH  /api/content/podcast/[id]
POST   /api/content/podcast/[id]/upload-audio
POST   /api/content/podcast/[id]/request-transcript
POST   /api/content/podcast/[id]/publish
```

```text
GET    /api/content/newsletters
POST   /api/content/newsletters
GET    /api/content/newsletters/[id]
PATCH  /api/content/newsletters/[id]
POST   /api/content/newsletters/[id]/sync-mailchimp
POST   /api/content/newsletters/[id]/publish
```

```text
GET    /api/content/media
POST   /api/content/media
GET    /api/content/media/[id]
PATCH  /api/content/media/[id]
DELETE /api/content/media/[id]
```

All mutation APIs must require an authenticated user and an appropriate role.

## 10. Mailchimp Integration Plan

Start with newsletter archive publishing inside the site. Add Mailchimp only after newsletter data is stable.

Phase 1:

- Store newsletter drafts and published archive pages locally.
- Do not send email from this system.
- Add a manual field for Mailchimp campaign ID if one exists.

Phase 2:

- Add Mailchimp API settings under `/admin/integrations`.
- Allow content manager to create or update a Mailchimp campaign from a published newsletter draft.
- Keep actual send as an explicit action requiring confirmation.

Phase 3:

- Add campaign status sync.
- Store Mailchimp campaign ID, send status, scheduled date, and sent date.
- Add audit log for any sync or send action.

Safety rule: do not automatically email a list just because a newsletter is published on the website.

## 11. MP3 Upload and Podcast Processing Plan

The current data and media automation lives outside the web app in the podcast workspace and on `farm`.

The CMS should not directly perform long-running transcription or vectorization in the web request.

Recommended workflow:

1. User uploads MP3 in `/content/podcast/new`.
2. File is stored in the configured object storage or server media path.
3. Metadata row is created in `content_podcast_uploads`.
4. User saves draft, schedules, or publishes directly.
5. When publishing is requested, the system creates a processing request for transcript/intelligence/vector jobs as needed.
6. Background worker processes the audio.
7. Content manager reviews metadata, transcript status, and public preview.
8. Content manager publishes the episode to the public archive.

Required background job states:

```text
Not Requested
Queued
Running
Completed
Failed
Skipped
```

## 12. Migration From Old pastorwood.org

The existing site should be replaced in stages.

### Stage 1: Mirror public content

- Keep current static lift-and-shift content working.
- Add database schema.
- Seed CMS tables from current hardcoded content.
- Render public routes from database while preserving visual design.

### Stage 2: Import historical posts

- Import WordPress devotional and written-resource posts.
- Preserve original source URLs.
- Generate clean slugs.
- Store HTML and normalized plain text.
- Auto-publish imported historical content by default, while logging import errors or questionable records for later cleanup.

### Stage 3: Public archive parity

- Ensure radio archive, devotional archive, written resources, board, endorsements, donate, contact, and privacy pages are covered.
- Add redirects from old URL patterns where practical.
- Validate SEO metadata.

### Stage 4: Domain cutover readiness

- Confirm every old critical page has a replacement.
- Confirm public routes do not require login.
- Confirm protected routes require login.
- Confirm analytics, donation links, and contact links work.
- Confirm Cloudflare route/domain plan.

## 13. UI Plan for `/content`

### `/content`

Dashboard showing:

- Drafts needing attention
- Recent edits
- Scheduled content
- Recently published content
- Failed podcast processing jobs
- Newsletter Mailchimp sync status
- Quick actions: New post, New podcast episode, New newsletter, Upload media

### `/content/pages`

Table with:

- Page title
- Slug
- Status
- Last updated
- Published date
- Owner/editor
- Actions: Edit, Preview, Publish, Archive

### `/content/posts`

Table with:

- Title
- Type
- Status
- Publish date
- Tags
- Last updated
- Actions

### `/content/podcast`

Table with:

- Title
- Program date
- Audio status
- Transcript status
- Public status
- Publish state
- Actions

### `/content/newsletters`

Table with:

- Title
- Subject
- Archive status
- Mailchimp status
- Scheduled/sent date
- Actions

### `/content/media`

Grid/list with:

- Thumbnail/icon
- Filename
- Type
- Size
- Alt text status
- Usage count
- Actions

## 14. Validation and Acceptance Criteria

### Public site acceptance

- Public visitors can load `/` without authentication.
- Public visitors can browse published posts and radio pages.
- Draft content never appears publicly.
- Old Pastor Wood content has replacement pages.
- Public site remains usable on mobile.
- Public site has working navigation, footer, contact links, donation links, and privacy links.

### Content portal acceptance

- `/content` requires login.
- Content Manager can create, edit, schedule, publish, and archive content directly.
- Admin can manage all content and users.
- Draft preview works only for authorized users.
- Publish action creates an audit event.
- Revision history allows rollback or comparison.

### Podcast upload acceptance

- MP3 upload creates a media asset.
- Metadata can be edited before publish.
- Audio can be previewed internally.
- Background processing can be requested without blocking the web request.
- Public episode appears only after publish.

### Newsletter acceptance

- Newsletter can be drafted and published to the site archive.
- Mailchimp sending is not automatic.
- Mailchimp sync/send actions are explicit and audited.

### Admin acceptance

- Admin area remains separate from content editing.
- User role changes are audited.
- Integration settings are admin-only.
- API keys and secrets are never displayed in logs or public pages.

## 15. Implementation Phases

### Phase 0: Current state checkpoint

Already completed:

- Unified app identified at `/Users/van/firebase/aic`.
- Public Pastor Wood shell exists.
- Protected AIC app exists.
- `/content` portal shell exists.
- Protected navigation includes Content.

### Phase 1: Route and role foundation

Deliverables:

- Expand roles beyond `User` and `Admin`.
- Add role checks for Content Manager.
- Decide whether existing `/overview`, `/archive`, `/research`, and `/compose` stay top-level or become grouped in navigation.
- Add placeholder route pages for `/content/pages`, `/content/posts`, `/content/podcast`, `/content/newsletters`, `/content/media`, and `/content/workflow`.

Acceptance:

- Protected routing works.
- `/content` is visible to content roles.
- `/admin` remains admin-only.

### Phase 2: CMS schema and read layer

Deliverables:

- Add migrations for content pages, revisions, posts, newsletters, media, workflow events, and audit log.
- Add server-side read functions in `lib/content-*` modules.
- Seed existing static Pastor Wood page content into database tables.

Acceptance:

- Public pages can be read from database.
- Draft/published separation exists.
- Migration applies cleanly on local and farm.

### Phase 3: Public rendering from CMS

Deliverables:

- Replace hardcoded Pastor Wood public content with CMS-backed rendering.
- Preserve current design and public route URLs.
- Add published-only guards.
- Add preview route for authenticated users.

Acceptance:

- Public site looks materially the same or better.
- Published content renders from database.
- Draft content does not leak publicly.

### Phase 4: Page and post editors

Deliverables:

- Build page list and editor.
- Build post list and editor.
- Add rich text or structured block editing.
- Add revision history.
- Add publish/unpublish/archive actions.

Acceptance:

- Content Manager can edit a public page without code changes.
- Content Manager can create and publish a post.
- Audit log records important changes.

### Phase 5: Media library

Deliverables:

- Add upload API and storage strategy.
- Build media list and detail views.
- Add image/audio/PDF metadata editing.
- Add alt text and caption fields.
- Add media picker for page/post editors.

Acceptance:

- User can upload an image and use it in a page/post.
- User can upload an MP3 as a managed media asset.
- Public/private asset visibility is enforced.

### Phase 6: Podcast upload and processing handoff

Deliverables:

- Build podcast upload editor.
- Store MP3 metadata.
- Add transcript/vector/intelligence processing request model.
- Show job status in `/content/podcast`.
- Publish approved podcast episodes to public archive.

Acceptance:

- New MP3 can be uploaded and saved as draft.
- Processing can be requested without blocking the web app.
- Episode appears publicly only after direct publish.

### Phase 7: Newsletter archive and Mailchimp sync

Deliverables:

- Build newsletter editor.
- Publish newsletter archive pages locally.
- Add Mailchimp campaign ID storage.
- Add optional Mailchimp campaign creation/update.
- Add explicit send/schedule action only after confirmation.

Acceptance:

- Newsletter can be published to the site archive.
- Mailchimp send does not happen accidentally.
- Mailchimp actions are audited.

### Phase 8: Old site migration and cutover

Deliverables:

- Import historical posts and resources.
- Map old URLs to new routes.
- Validate public pages against old site inventory.
- Add redirects if needed.
- Prepare Cloudflare/domain cutover checklist.

Acceptance:

- Public site is ready to replace old pastorwood.org.
- Critical content and links are accounted for.
- Domain cutover does not expose protected pages.

## 16. Recommended Immediate Next Tasks

1. Add placeholder pages under `/content/pages`, `/content/posts`, `/content/podcast`, `/content/newsletters`, `/content/media`, and `/content/workflow`.
2. Expand RBAC to include Content Manager and keep the first release free of approval workflow requirements.
3. Create the CMS database migration.
4. Seed current static Pastor Wood page content into the CMS tables.
5. Convert one public page, preferably `/about-pastor-wood`, to render from published CMS content.
6. Build the first editable page screen for that same page.
7. Add audit logging for save and publish actions.

## 17. Resolved Decisions

1. Existing protected research routes remain protected as-is for now.
2. Content managers can publish directly in the first release. No approval workflow is needed while only one person manages content.
3. Imported historical WordPress posts should auto-publish by default.
4. Final MP3 files should live in MinIO for now, with the design kept open for a future R2 migration.
5. Newsletters should archive locally first. Mailchimp sync/send can be added later as explicit audited actions.
6. The old `www.pastorwood.org` domain will eventually point to this app.

## 18. Non-Goals for the First CMS Release

Do not build these in the first release unless explicitly prioritized:

- Full WordPress-compatible editor parity.
- Automatic newsletter sends.
- Unreviewed AI-generated public posts.
- Direct editing of transcript/vector internals from public content editors.
- Public user accounts or donor account management.
- Donation processing replacement.
- Full podcast hosting replacement before upload/storage/process workflow is proven.

## 19. Deployment Notes

Normal web app deploy flow:

```bash
cd /Users/van/firebase/aic
npm run lint
npm run build
git status --short
git add <changed-files>
git commit -m "<message>"
git push origin main
npm run deploy:farm
```

After deployment:

```bash
ssh farm 'cd /mnt/storage/aic && git rev-parse --short HEAD && systemctl is-active aic-web.service && curl -fsS http://127.0.0.1:8087/login >/dev/null && echo ok'
curl -LfsS --max-time 20 https://pastorwood.ammonsfarm.org/ | grep -F 'Welcome to Abiding in Christ'
```

Do not directly edit `farm:/mnt/storage/aic` except for an approved emergency hotfix that is immediately backported to Git.
