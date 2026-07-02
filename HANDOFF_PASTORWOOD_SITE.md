# Pastor Wood Website Handoff

Date: 2026-06-27

## Scope

This handoff is for the public Pastor Wood website work on `https://pastorwood.ammonsfarm.org/`.

Keep this thread/workstream focused on the website only. SermonAudio, transcript, Whisper, vectorization, and RAG processing context was split into a separate Codex thread titled `AIC Podcast Transcript Processing`.

## Project and deploy surface

- Local repo: `/Users/van/firebase/aic`
- GitHub repo: `https://github.com/ammonsfarm/aic.git`
- Server checkout: `farm:/mnt/storage/aic`
- Service: `aic-web.service`
- Public tunnel target: `http://127.0.0.1:8087`
- Public host: `https://pastorwood.ammonsfarm.org/`
- Cloudflare public hostname route points `pastorwood.ammonsfarm.org` to `http://localhost:8087` on the farm tunnel.

Normal web deploy flow from `/Users/van/firebase/aic`:

```bash
npm run lint
npm run build
git status --short
git add <changed-files>
git commit -m "<message>"
git push origin main
npm run deploy:farm
```

Post-deploy validation pattern:

```bash
ssh farm 'cd /mnt/storage/aic && git rev-parse --short HEAD && systemctl is-active aic-web.service && curl -fsS http://127.0.0.1:8087/login >/dev/null && echo ok'
curl -LfsS --max-time 20 https://pastorwood.ammonsfarm.org/ | grep -F 'Welcome to Abiding in Christ'
```

Known non-blocking warnings during build:

- `@next/next/no-img-element` warnings for temporary remote source-site images in `components/pastor-wood-site.tsx`.
- Turbopack NFT warning from `app/api/audio/[trackId]/route.ts`; this predates the Pastor Wood page work.

## Latest deployed website state

Latest deployed commit before this handoff:

- `661dc35 Refine Pastor Wood public site copy and brand`

That commit was pushed to `main`, deployed to `farm:/mnt/storage/aic`, and `aic-web.service` was restarted successfully.

Validation performed after deploy:

- Service active on farm.
- `/contact` contained `Get in touch` and `Invite Pastor Wood to speak.`
- `/about-pastor-wood` contained `Life and Ministry` and `Founder of Wears Valley Ranch, pastor, author, and host of Abiding in Christ.`
- `/` contained `Welcome to Abiding in Christ`.
- The dead extra `Contact` link inside `.pw-contact__panel` was removed. Note: top nav still has a normal `Contact` link, which is expected.

## Main files involved

- `components/pastor-wood-site.tsx`
- `app/globals.css`
- `app/about-pastor-wood/page.tsx`
- `app/endorsements/page.tsx`
- `app/board-members/page.tsx`
- `app/bible-study/page.tsx`
- `app/written-resources/page.tsx`
- `app/contact/page.tsx`
- `app/donate/page.tsx`
- `app/donor-dashboard/page.tsx`
- `app/privacy-terms-conditions/page.tsx`
- `app/radio/[[...slug]]/page.tsx`
- `public/images/pastorwood/`

## What has been built

The public Pastor Wood site now uses the AIC Next app and renders different content for `pastorwood.ammonsfarm.org`.

Implemented public routes:

- `/`
- `/about-pastor-wood`
- `/endorsements`
- `/board-members`
- `/radio`
- `/radio/[[...slug]]`
- `/bible-study`
- `/written-resources`
- `/contact`
- `/donate`
- `/donor-dashboard`
- `/privacy-terms-conditions`

Content direction:

- Lift-and-shifted the public-worthy content from `pastorwood.org` into a modern layout.
- No GPT/RAG/chat feature is on the public Pastor Wood site yet.
- Radio audio players currently point to original `pastorwood.org` MP3 URLs.
- Donation and donor dashboard pages intentionally link back to original `pastorwood.org` for now.
- Weekly devotional and written resources currently use curated static summaries and source links, not a database yet.

## Recent user feedback already addressed

- Hero text on first version was too large: replaced with a more grounded `Welcome to Abiding in Christ` layout.
- Partial face portrait issue: removed the partial overlay and used full source imagery where appropriate.
- Unnecessary audio hosting disclaimer: removed.
- Endorsements missing photos: added source-site photos where available and initials placeholders where source photos were not provided.
- Contact page repeated `Contact` too many times: revised copy to `Reach Us`, `Get in touch`, `Ministry Office`, and `Invite Pastor Wood to speak.`
- Dead `Contact` panel link on contact page: removed.
- About page repeated `Bio` too many times and referenced the original site: revised to `Life and Ministry`, `Jim Wood`, and removed the original-site wording.

## Logo work and current pending state

User provided/added new logo assets in:

```text
/Users/van/firebase/aic/public/images/pastorwood
```

Relevant files currently present there:

```text
deep forest square.jpg
deep forest wide.jpg
monochrome square.jpg
smoky-mountain-church.png
sunrise square.jpg
sunrise wide.jpg
sunset square.jpg
sunset wide.jpg
```

User said: `For now lets go with the deep forest.`

Important constraint from user:

- Do not use GPT/image generation for photo edits unless explicitly requested.
- If a photo needs more than local cropping/transparency/resize, ask the user and they will use ChatGPT manually.
- Local tooling such as `ffmpeg`, `sips`, or other installed image utilities is acceptable for crop/resize/transparency.

Pending local logo status at handoff:

- A local transparent/cropped logo was generated with `ffmpeg` from `public/images/pastorwood/deep forest wide.jpg`:

```text
public/images/pastorwood/deep-forest-logo-transparent.png
```

- The generated transparent PNG was inspected and showed the full wordmark preserved. It is approximately `760x295`.
- The previous turn was interrupted before the component/CSS were fully updated and before commit/deploy.
- There may be a local uncommitted change in `components/pastor-wood-site.tsx` that points the header image at the raw JPG `deep forest wide.jpg` instead of the transparent PNG.
- Before continuing, check local status and confirm the exact diff:

```bash
cd /Users/van/firebase/aic
git status --short
git diff -- components/pastor-wood-site.tsx app/globals.css
```

Recommended next step for logo:

1. Use `public/images/pastorwood/deep-forest-logo-transparent.png` in the header brand link.
2. Adjust `.pw-brand-wordmark` CSS so the logo fits cleanly in the nav without stretching, likely around `width: clamp(190px, 22vw, 300px)` and a fixed visual height via the image aspect ratio.
3. Remove or leave harmless any old SVG-specific CSS, but avoid broken styling.
4. Run lint/build.
5. Commit and deploy.

Do not generate a new image. Do not call GPT image tools.

## Devotional database and RAG plan

User noted that `/bible-study` should be future-proofed. The current hardcoded post list is temporary.

Proposed plan, not yet implemented:

1. Add Postgres tables for `pastorwood_posts`, `pastorwood_post_chunks`, and `pastorwood_scrape_runs`.
2. Scrape all Weekly Devotional and Written Resources posts from `pastorwood.org`, preferably via WordPress REST API if available, otherwise archive HTML crawling.
3. Store canonical `source_url`, slug, title, author, category, publish date, excerpt, full text, HTML, checksum, and scrape timestamp.
4. Add incremental sync by checksum or modified date so future posts update cleanly.
5. Chunk and embed devotional/resource content into the existing RAG pipeline with a source type such as `pastorwood_devotional` or `pastorwood_resource`.
6. Update `/bible-study` and `/written-resources` to render from Postgres instead of static arrays.
7. Later, blend these posts into Pastor Wood GPT/RAG retrieval as a separate lane from sermon transcripts.

Keep this database/RAG implementation separate from quick website styling fixes unless the user explicitly asks to start it in this website thread.

## Safety and coordination notes

- Read `/Users/van/firebase/aic/CONTRIBUTING_AI.md` before changing/deploying AIC app code.
- Do not edit directly on `farm:/mnt/storage/aic` except emergency hotfixes that are immediately backported.
- Do not revert unrelated changes.
- If `git status --short` shows unexpected files beyond the website/logo work, stop and ask the user.
- Do not run GPT/image-generation tools for logo/photo edits without explicit user approval.
- Do not bring transcript processing context back into this website thread.
