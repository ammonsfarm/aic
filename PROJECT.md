# AIC Podcast Podtrac Reporting Project

This folder contains a local workflow for turning Podtrac publisher report captures into a normalized SQLite database, generated report images, PDFs, and follow-on CSV analysis.

## Latest Website Update

- 2026-05-19: Completed and pushed homepage refresh on `main` (commit `74eaa4c`), including top-rail branding, hero/bio content, listen links, affiliate section, and navigation updates.  
- Related files: `app/page.tsx`, `components/top-rail.tsx`, `lib/navigation.ts`, `app/layout.tsx`, `app/globals.css`, `public/images/pastor-wood.jpg`.
- Build and lint validations passed before push (`npm run lint`, `npm run build`).

## Current Data Window

The clean imported daily-detail window is:

- Start: `2026-02-01`
- End: `2026-04-30`
- Actual daily total: `118,626` downloads

The SQLite database also contains synthetic `2025-12-31` rows used for pre-window totals. In the current clean rebuild those synthetic daily episode rows sum to `0`. Report scripts intentionally exclude `2025-12-31` unless they are specifically analyzing pre-window totals.

## Core Files

- `podtrac_stats.sqlite3`: normalized SQLite database.
- `podtrac-auth.curl`: local authenticated curl capture used by the fetcher. Treat this as sensitive session material and do not share or commit it.
- `fetch_podtrac_episode_day.py`: authenticated Podtrac API fetcher that writes importable HAR-like files.
- `import_podtrac_har.py`: importer for Podtrac HAR-like files into SQLite.
- `generate_podtrac_report_assets.py`: generates five full-page PNG chart/report pages from SQLite.
- `generate_podtrac_report_pdf.py`: generates print-sized and high-fidelity PDFs from the executive summary and PNG pages.
- `generate_non_us_episode_estimates.py`: creates estimated non-USA country/episode CSV outputs from separate episode-by-date and country-by-date aggregates.
- `catalog_podcast_mp3s.py`: catalogs MP3 filenames into SQLite, and can optionally write parsed ID3 metadata and rename files to `<soundcloud_id>.mp3`.
- `transcribe.py.remote`: local reference copy of the current server transcription script at `/home/ammonsfarm/gemini-transcribe/transcribe.py`.

## Imported Batch HAR Files

The clean rebuild used these batch files:

- `publisher.podtrac.com-episode-batch-2026-02-01_2026-04-30.har`
- `publisher.podtrac.com-country-batch-2026-02-01_2026-04-30.har`
- `publisher.podtrac.com-client-batch-2026-02-01_2026-04-30.har`

Earlier manual/catch-up HAR files are still present for reference, but the clean database rebuild came from the three batch files above.

## SQLite Shape

Primary tables:

- `Episode(Episode_ID, Title, Date, Import_Run_ID, Imported_At)`
- `Country(Country_ID, Name, Import_Run_ID, Imported_At)`
- `Client(Client_ID, Name, Import_Run_ID, Imported_At)`
- `Daily_Activity(Date, Episode, Count, Import_Run_ID, Imported_At)`
- `Activity_By_Country(Date, Country, Count, Import_Run_ID, Imported_At)`
- `Activity_By_Client(Date, Client, Count, Import_Run_ID, Imported_At)`
- `Import_Run(Run_ID, Imported_At, Source_Har_Files, Summary)`
- `Import_Metadata(Key, Value)`

The importer is append-only by default. It tracks row provenance using `Import_Run_ID` and `Imported_At`.

## Main Commands

Fetch the three daily batch reports:

```bash
python3 fetch_podtrac_episode_day.py \
  --report episode \
  --start 2026-02-01 \
  --end 2026-04-30 \
  --curl-file podtrac-auth.curl \
  --output publisher.podtrac.com-episode-batch-2026-02-01_2026-04-30.har

python3 fetch_podtrac_episode_day.py \
  --report country \
  --start 2026-02-01 \
  --end 2026-04-30 \
  --curl-file podtrac-auth.curl \
  --output publisher.podtrac.com-country-batch-2026-02-01_2026-04-30.har

python3 fetch_podtrac_episode_day.py \
  --report client \
  --start 2026-02-01 \
  --end 2026-04-30 \
  --curl-file podtrac-auth.curl \
  --output publisher.podtrac.com-client-batch-2026-02-01_2026-04-30.har
```

Import the batch HAR files:

```bash
python3 import_podtrac_har.py --db podtrac_stats.sqlite3 \
  publisher.podtrac.com-episode-batch-2026-02-01_2026-04-30.har \
  publisher.podtrac.com-country-batch-2026-02-01_2026-04-30.har \
  publisher.podtrac.com-client-batch-2026-02-01_2026-04-30.har
```

Regenerate report PNGs and markdown summary:

```bash
/Users/van/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  generate_podtrac_report_assets.py
```

Regenerate both PDFs:

```bash
/Users/van/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  generate_podtrac_report_pdf.py --hifi
```

Generate non-USA country/episode estimates:

```bash
/Users/van/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
  generate_non_us_episode_estimates.py
```

Catalog MP3 files on the podcast storage server without changing files:

```bash
scp catalog_podcast_mp3s.py farm:/tmp/catalog_podcast_mp3s.py
ssh farm 'python3 /tmp/catalog_podcast_mp3s.py /mnt/storage/podcasts \
  --db /mnt/storage/podcasts/podcast_file_catalog.sqlite3 \
  --jsonl /mnt/storage/podcasts/podcast_file_catalog.jsonl'
```

Apply parsed metadata and rename files to `<soundcloud_id>.mp3` only after reviewing the dry-run catalog:

```bash
ssh farm 'python3 /tmp/catalog_podcast_mp3s.py /mnt/storage/podcasts \
  --db /mnt/storage/podcasts/podcast_file_catalog.sqlite3 \
  --jsonl /mnt/storage/podcasts/podcast_file_catalog.jsonl \
  --apply'
```

## Podcast Audio And Transcription Workflow

The podcast audio archive lives on the `farm` server:

- Server folder: `/mnt/storage/podcasts`
- Google Cloud Storage prefix: `gs://aic-podcasts-2026/podcasts/`
- Server transcription workspace: `/home/ammonsfarm/gemini-transcribe`

The MP3 archive was normalized on `2026-05-02`:

- All MP3 files in `/mnt/storage/podcasts` were renamed to `<soundcloud_id>.mp3`.
- Parsed filename metadata was written into ID3 tags.
- The catalog database and JSONL audit were written to:
  - `/mnt/storage/podcasts/podcast_file_catalog.sqlite3`
  - `/mnt/storage/podcasts/podcast_file_catalog.jsonl`
- Local copies are:
  - `podcast_file_catalog.sqlite3`
  - `podcast_file_catalog.jsonl`

The current ID3 tagging convention is:

- `title`: parsed episode title.
- `artist`: `AIC / WVR`.
- `album`: `Abiding in Christ w/ Jim Wood`.
- `genre`: `Religion & Spirituality`.
- `date`: full parsed publish date, such as `2017-10-20`.
- `TXXX:Podcast ID` and `COMM:Podcast ID`: SoundCloud numeric ID.
- `TXXX:Category`: parsed first filename section.
- `TXXX:Detail`: parsed second filename section.
- `TXXX:Original filename` and `COMM:Original filename`: pre-rename filename.

### Gemini Transcription Script

The server script is:

```text
/home/ammonsfarm/gemini-transcribe/transcribe.py
```

Keep the local reference copy in sync when editing:

```bash
scp farm:/home/ammonsfarm/gemini-transcribe/transcribe.py transcribe.py.remote
```

After local edits, validate and install:

```bash
python3 -m py_compile transcribe.py.remote
scp transcribe.py.remote farm:/home/ammonsfarm/gemini-transcribe/transcribe.py
ssh farm '/home/ammonsfarm/gemini-transcribe/venv/bin/python -m py_compile /home/ammonsfarm/gemini-transcribe/transcribe.py'
```

The transcription script currently:

- Uses Vertex AI / ADC by default with project `gen-lang-client-0764311735` and location `us-central1`.
- Also supports API-key env vars: `GEMINI_API_KEY`, `GOOGLE_API_KEY`, or `GOOGLE_GENAI_API_KEY`.
- Loads episode context from `/mnt/storage/podcasts/podcast_file_catalog.sqlite3`.
- Splits each local MP3 into 120-second chunks with `ffmpeg`.
- Sends chunks to Gemini as inline audio bytes.
- Keeps chunks within each episode sequential.
- Supports file-level parallelism with `TRANSCRIBE_WORKERS`.
- Merges chunk JSON into one `<soundcloud_id>.json` transcript.
- Retries empty responses, malformed chunk JSON, `429 RESOURCE_EXHAUSTED`, and transient service errors.
- Splits a bad chunk into smaller sub-chunks if parsing repeatedly fails.
- Records chunk-level error placeholders instead of failing the whole batch when all fallback attempts fail.
- Post-processes timestamps into `HH:MM:SS`, repairs backwards segment ends, normalizes known WVR spelling, and marks recurring announcer/contact copy.
- Adds deterministic Bible-reference enrichment for explicit phrases like `James chapter 1`, `Epistle of James`, and `first 18 verses`, then carries the active passage into nearby scripture-reading segments.

Output JSON keeps full transcript fidelity. Later vectorization should include content-bearing segments only, such as `speech`, `scripture_reading`, and likely `prayer`, while excluding `intro`, `outro`, `music`, `advertisement`, and `silence`.

## OpenAI Speech Embedding Batch

The first RAG embedding pass uses OpenAI `text-embedding-3-small` through the Batch API. The local script is:

- `build_openai_speech_embedding_batch.py`

It reads Gemini transcript JSON files from `/Volumes/gemini-transcribe`, embeds only canonical `segments[]` items where `segment_type == "speech"`, and avoids repeated derived fields such as `bible_references`, `other_references`, `program_elements`, and `chunks`. Speaker attribution is included in the embedded text and preserved in the sidecar metadata JSONL.

Create or update `.env` before submitting:

```bash
OPENAI_API_KEY=replace_with_your_openai_api_key
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

Generate a dry-run batch from five random transcripts:

```bash
python3 build_openai_speech_embedding_batch.py
```

Submit the generated batch to OpenAI after updating `.env`:

```bash
python3 build_openai_speech_embedding_batch.py --submit
```

The SMB mount at `/Volumes/gemini-transcribe` may expose server-created `0600` JSON files that are not readable through guest SMB. Prefer syncing from `farm` over SSH into the local cache before embedding:

```bash
mkdir -p transcript_cache
rsync -av --include='*.json' --exclude='*' \
  farm:/home/ammonsfarm/gemini-transcribe/ \
  transcript_cache/
```

Generate and submit a batch for every cached transcript that is not already indexed:

```bash
python3 build_openai_speech_embedding_batch.py \
  --transcript-dir transcript_cache \
  --all \
  --skip-indexed-db rag_test.sqlite3 \
  --max-requests 1500 \
  --max-chars 4000 \
  --submit
```

Later, run the same `rsync` command and then the same embedding command again to pick up only newly added transcript JSON files. The `--max-requests` cap is applied between files so a transcript is not partially indexed. `--max-chars 4000` keeps embedding inputs below model context limits; the script also splits unusually long individual speech segments before embedding.

The script writes:

- `openai_embedding_batches/speech-embeddings-*.jsonl`: OpenAI Batch input file for `/v1/embeddings`.
- `openai_embedding_batches/speech-embeddings-*.metadata.jsonl`: local metadata keyed by `custom_id`.
- `openai_embedding_batches/speech-embeddings-*.summary.json`: run summary.
- `openai_embedding_batches/speech-embeddings-*.summary.submission.json`: OpenAI upload and batch response when `--submit` is used.

After a batch completes, build a local SQLite RAG test index:

```bash
python3 prepare_rag_index.py \
  --batch-output openai_embedding_batches/batch_69f7890943f48190b61255a086901755.output.jsonl \
  --metadata openai_embedding_batches/speech-embeddings-20260503T174232Z.metadata.jsonl \
  --batch-input openai_embedding_batches/speech-embeddings-20260503T174232Z.jsonl \
  --db rag_test.sqlite3 \
  --replace
```

Run semantic retrieval against the local test index:

```bash
python3 query_rag_index.py "What does Jim Wood teach about faith?" --top-k 5
```

## Episode Intelligence Embeddings

The RAG database also has a derived episode-intelligence layer generated from transcript speech. It stores episode summaries plus structured items such as stories, sermon illustrations, scripture references, interviews, people, books, organizations, places, and quotes.

Vectorize this derived layer separately from raw transcript chunks:

```bash
python3 build_openai_intelligence_embedding_batch.py \
  --db rag_test.sqlite3 \
  --max-requests 800 \
  --submit
```

The script reads current rows from `episode_intelligence` and `episode_intelligence_items`, builds one embedding object per useful summary/item, and skips unchanged objects already stored in `episode_intelligence_vectors` by comparing a SHA-256 content hash. Codex-generated summaries are ordered before `local-extractive` fallback rows so the highest-quality intelligence objects are embedded first.

After an OpenAI Batch job completes, import it:

```bash
python3 prepare_intelligence_vector_index.py \
  --batch-output openai_embedding_batches/batch_<id>.output.jsonl \
  --metadata openai_embedding_batches/intelligence-embeddings-<stamp>.metadata.jsonl \
  --batch-input openai_embedding_batches/intelligence-embeddings-<stamp>.jsonl \
  --db rag_test.sqlite3
```

Imported vectors live in `episode_intelligence_vectors`. Keep this table separate from `rag_chunks` so retrieval can weight raw transcript evidence and derived intelligence differently.

## Postgres Serving Database

SQLite remains the local staging and audit database. The serving database for future private/public web apps is PostgreSQL with `pgvector`.

Current dev target:

- Host: `finsvc`
- Server project directory: `/home/openclaw/aic`
- GitHub repo: `https://github.com/ammonsfarm/aic.git`
- Database: `aic`

The local `.env` stores `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. Do not print or commit those values.

The Postgres tooling is:

- `postgres/migrations/001_init.sql`
- `postgres/migrations/002_podtrac.sql`
- `apply_postgres_migrations.py`
- `sync_sqlite_to_postgres.py`
- `sync_podtrac_to_postgres.py`
- `requirements-postgres.txt`

Apply migrations:

```bash
.venv-pg/bin/python apply_postgres_migrations.py
```

Sync SQLite staging data to Postgres:

```bash
.venv-pg/bin/python sync_sqlite_to_postgres.py --sqlite-db rag_test.sqlite3
```

Sync Podtrac statistics to Postgres:

```bash
.venv-pg/bin/python sync_podtrac_to_postgres.py --podtrac-db podtrac_stats.sqlite3
```

The serving schema keeps:

- `episodes`
- `transcript_chunks` with `embedding vector(1536)`
- `episode_intelligence`
- `episode_intelligence_items`
- `episode_intelligence_vectors` with `embedding vector(1536)`
- `podtrac_episodes`, linked back to `episodes.track_id`
- `podtrac_daily_activity`
- `podtrac_countries` and `podtrac_activity_by_country`
- `podtrac_clients` and `podtrac_activity_by_client`

As of the initial Podtrac sync, Postgres contained `2613` Podtrac episodes, `17803` episode/day rows, `115` countries, `2514` country/day rows, `26` clients, and `920` client/day rows. The three activity tables each total `118626` downloads for the clean `2026-02-01` through `2026-04-30` window.

Podtrac episode ids are opaque and do not match the SoundCloud/RAG `track_id`. `sync_podtrac_to_postgres.py` preserves the Podtrac id, then fills `podtrac_episodes.track_id` by normalized title matching. If multiple RAG episodes share the same normalized title, it chooses the nearest publish date and records `match_method = normalized_title_nearest_date`.

Generate a cited RAG answer from the retrieved chunks:

```bash
python3 query_rag_index.py "What does Jim Wood teach about faith?" --top-k 5 --answer
```

Use the Silo/OpenAI Codex inference endpoint for the answer step while keeping OpenAI embeddings for retrieval:

```bash
python3 query_rag_index.py \
  "Create a 60 day bible study plan with 10 minutes of commentary from Pastor Jim Wood per day based on the New Testament" \
  --top-k 20 \
  --answer \
  --answer-provider silo-chat \
  --answer-model openai-codex/gpt-5.5
```

The script reads `SILO_TEMP_KEY` from `.env` and logs the full request/response payloads under `rag_query_logs/*` without logging authorization headers.

Run the local RAG chat web form:

```bash
python3 rag_chat_app.py
```

Default URL:

```text
http://127.0.0.1:8087
```

The app uses `OPENAI_API_KEY` for query embeddings, `SILO_TEMP_KEY` for answer generation through `http://192.168.1.195:4041/v1/chat/completions`, and `rag_test.sqlite3` for retrieval. The default Silo model is `openai-codex/gpt-5.3-codex-spark` for faster test responses. Set `RAG_ANSWER_PROVIDER=direct-codex` to temporarily bypass Silo and call ChatGPT Codex directly with `OPENAI_SESSION_TOKEN`.
It also exposes a local Bible passage tool:

```bash
curl -sS http://127.0.0.1:8087/api/tools/bible-passage \
  -H 'Content-Type: application/json' \
  -d '{"query":"Create an article on James Chapter 1"}'
```

`bible_passage.fetch` detects references such as `James Chapter 1`, fetches the passage from YouVersion using `YVP_APP_KEY`, and passes the tool result into the Silo prompt alongside retrieved Pastor Jim Wood transcript chunks.

The app also exposes a local full-sermon reconstruction tool:

```bash
curl -sS http://127.0.0.1:8087/api/tools/full-sermon \
  -H 'Content-Type: application/json' \
  -d '{"track_ids":["1360473958"],"max_sermons":1,"max_chars_per_sermon":12000}'
```

`full_sermon.fetch` rebuilds chronological sermon speech from indexed chunks. The chat flow invokes it automatically for long-form requests about Pastor Wood's style, expository preaching examples, sermons, or article drafting, then passes that context to the Silo prompt as `[S1]`, `[S2]`, etc. Short discovery questions such as "what sermon illustrations..." should use corpus discovery first rather than pulling unrelated full sermons.

For long-form article or sermon requests, `rag_chat_app.py` defaults to sending the full gathered context to Silo/Codex. Set `RAG_FORCE_COMPACT_LONGFORM=1` only when the direct Codex backend is returning incomplete SSE streams without a final `response.completed` event and a bounded first-draft fallback is preferred.

Corpus-wide count/list questions should not rely on semantic top-k retrieval. `rag_chat_app.py` includes a `corpus_search.count` tool for interview/guest episode questions. For example, “How many episodes are of Pastor Wood interviewing someone?” uses SQLite metadata across the indexed corpus and currently reports both a broad speaker co-occurrence count and a narrower title-based interview count.

Broad discovery questions should also not rely only on semantic top-k retrieval. `rag_chat_app.py` includes a general `corpus_search.discovery` pass that extracts useful query terms, adds query-sensitive phrase expansions, scans indexed transcript chunks, and returns `[D1]`, `[D2]`, etc. This is intentionally a general discovery lane for examples, stories, people, places, and themes instead of one bespoke search for each topic.

### Running Transcription Batches

Create a batch list from GCS objects that do not already have server JSON output:

```bash
cd /home/ammonsfarm/gemini-transcribe
gsutil ls 'gs://aic-podcasts-2026/podcasts/*.mp3' | sort |
while read -r uri; do
  id=$(basename "$uri" .mp3)
  [ -f "$id.json" ] || echo "$uri"
done | head -500 > files-batch-500-$(date +%Y%m%d-%H%M%S).txt
```

Launch a 4-worker batch:

```bash
cd /home/ammonsfarm/gemini-transcribe
nohup env \
  GOOGLE_CLOUD_PROJECT=gen-lang-client-0764311735 \
  GOOGLE_CLOUD_LOCATION=us-central1 \
  TRANSCRIBE_CHUNK_SECONDS=120 \
  TRANSCRIBE_WORKERS=4 \
  /home/ammonsfarm/gemini-transcribe/venv/bin/python transcribe.py BATCH_FILE.txt \
  > transcribe-batch-$(date +%Y%m%d-%H%M%S).log 2>&1 &
```

Monitor the active batch:

```bash
tail -f /home/ammonsfarm/gemini-transcribe/TRANSCRIBE_LOG.log
```

Check a batch's completion count:

```bash
cd /home/ammonsfarm/gemini-transcribe
sed 's#.*/##; s#.mp3##' BATCH_FILE.txt |
while read id; do
  [ -f "$id.json" ] && echo "$id"
done | wc -l
```

Check remaining files in a batch:

```bash
cd /home/ammonsfarm/gemini-transcribe
sed 's#.*/##; s#.mp3##' BATCH_FILE.txt |
while read id; do
  [ -f "$id.json" ] || echo "$id"
done
```

Check for hard errors:

```bash
grep -nE 'ERROR|FAIL|CHUNK_ERROR|Traceback|Killed|worker_future' TRANSCRIBE_LOG.log | tail -40
```

`429 RESOURCE_EXHAUSTED` is expected under 4 workers. The script retries those. If many chunks end with `CHUNK_ERROR`, reduce `TRANSCRIBE_WORKERS` or rerun the failed IDs later.

### Current Batch State

As of `2026-05-03`:

- Initial 250-file batch: complete after retrying 25 failed files.
- Current 500-file batch:
  - Batch file: `/home/ammonsfarm/gemini-transcribe/files-batch-500-20260503-091937.txt`
  - Log file: `/home/ammonsfarm/gemini-transcribe/transcribe-batch-500-20260503-091937.log`
  - Process PID observed: `851798`
  - Started with `TRANSCRIBE_WORKERS=4`
  - This active process was launched before the Bible-reference enrichment patch was installed, so its output may not include that new post-processing behavior. The next launched batch will.

## Generated Report Outputs

Executive summary:

- `executive_summary_last_90_days.md`

PNG report pages:

- `podtrac_report_images/01_growth_overview.png`
- `podtrac_report_images/02_weekly_acceleration.png`
- `podtrac_report_images/03_top_episodes.png`
- `podtrac_report_images/04_country_growth.png`
- `podtrac_report_images/05_audience_mix.png`

PDF outputs:

- `podtrac_last_90_days_executive_summary.pdf`: print-friendly Letter-sized PDF.
- `podtrac_last_90_days_executive_summary_hifi.pdf`: high-fidelity PDF where chart pages stay at native `1600 x 2200` size.

## Non-USA Episode Estimates

The database does not currently contain exact `episode x country x date` data. It only contains:

- episode by activity date
- country by activity date

Because of that, `generate_non_us_episode_estimates.py` estimates country/episode downloads by applying each country's daily share to each episode's downloads on the same activity date. Treat these outputs as directional, not exact attribution.

Generated estimate files:

- `podtrac_non_us_country_episode_estimates.md`
- `podtrac_non_us_country_episode_estimates_all.csv`
- `podtrac_non_us_country_episode_estimates_top20.csv`
- `podtrac_vietnam_episode_estimates_by_date.csv`

Known result from the estimate run: Vietnam's estimated top episode is `SAS Chapel: Philippians 2:1-18`, estimated at `227.02` Vietnam downloads over the `2026-02-01` through `2026-04-30` window.

## Important Findings From The 90-Day Report

- Total measured downloads: `118,626`.
- February downloads: `4,136`.
- March downloads: `4,184`.
- April downloads: `110,306`.
- April accounts for about `93.0%` of measured activity.
- Peak day: `2026-04-24` with `6,998` downloads.
- Vietnam is the largest country by volume with `62,096` downloads.
- Edge dominates the client/device table with `108,152` downloads, or about `91.2%` of measured activity. This should be reviewed before making audience-quality conclusions.

## Notes And Constraints

- Do not use SVG for final chart assets in this project. The report images are PNGs.
- Keep exact quantitative charts data-backed from SQLite. Do not use generative images for precise numeric charts.
- Treat `podtrac-auth.curl` as sensitive because it contains session authentication.
- Podtrac export is a premium feature, so this workflow relies on authenticated API calls copied from browser DevTools and HAR-like captures.
- If an exact country-by-episode report is needed later, confirm whether Podtrac exposes a supported API filter or endpoint for `episode x country`; guessed country filters were tested and ignored by the existing endpoint.

## Planned Roadmap

The current project is the local Podtrac import/reporting foundation. The planned direction is broader:

1. Convert all podcast episodes to text using Gemini speech-to-text.
2. Vectorize the episode transcripts.
3. Load vectors into a vector database.
4. Build a RAG layer over the podcast transcript corpus.
5. Build an automated weekly agent that:
   - logs in to the Podtrac website or uses the authenticated cookie material from `podtrac-auth.curl`;
   - runs the weekly Podtrac extraction;
   - imports the weekly data into SQLite;
   - downloads any new episodes from the week;
   - transcribes new episode audio;
   - vectorizes new transcript content;
   - loads new vectors into the vector database.
6. Build a website for the podcast owner that includes:
   - the weekly stats/reporting views from the SQLite data;
   - the generated chart/report outputs;
   - an LLM/RAG query interface over the full episode transcript context.
7. Build a public website that lists all episodes, links to audio, shows summary data and full transcripts.

Website planning is captured in `WEBSITE_PLAN.md`. Implementation-ready Codex `/goal` prompts are captured in `WEBSITE_GOAL_PROMPTS.md`.

## CLERK Auth for Website:
# Add Clerk to Next.js App Router

If a Next.js App Router project does not already exist, first create one using:

```bash
npx create-next-app@latest my-clerk-app --yes
```

Install `@clerk/nextjs@latest`. Create `proxy.ts` with `clerkMiddleware()` from `@clerk/nextjs/server` (in `src/` if it exists, otherwise project root). Add `<ClerkProvider>` inside `<body>` in `app/layout.tsx`. Use `<Show>`, `<UserButton>`, `<SignInButton>`, `<SignUpButton>` from `@clerk/nextjs`.

Latest docs: https://clerk.com/docs/nextjs/getting-started/quickstart

## Install

```bash
npm install @clerk/nextjs
```

## proxy.ts

```typescript
import { clerkMiddleware } from '@clerk/nextjs/server'

export default clerkMiddleware()

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
```

## app/layout.tsx

```typescript
import { ClerkProvider, SignInButton, SignUpButton, Show, UserButton } from "@clerk/nextjs";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>
          <header>
            <Show when="signed-out">
              <SignInButton />
              <SignUpButton />
            </Show>
            <Show when="signed-in">
              <UserButton />
            </Show>
          </header>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
```

## Rules

ALWAYS:

- Use `clerkMiddleware()` from `@clerk/nextjs/server` in `proxy.ts`
- Add `<ClerkProvider>` inside `<body>` in `app/layout.tsx`
- Import from `@clerk/nextjs` or `@clerk/nextjs/server`
- Use App Router (app/page.tsx, app/layout.tsx)
- async/await with auth() from `@clerk/nextjs/server`
- Use existing package manager

NEVER:

- Reference `_app.tsx` or pages router
- Use `authMiddleware()` (replaced by `clerkMiddleware()`)
- Use old env var patterns
- Import deprecated APIs (withAuth, old currentUser)
- Use deprecated `<SignedIn>`, `<SignedOut>` (replaced by `<Show>`)

## Deprecated (DO NOT use)

```typescript
import { authMiddleware } from '@clerk/nextjs' // WRONG
function MyApp({ Component, pageProps }) {} // pages router, WRONG
pages / signin.js // WRONG
<SignedIn> // WRONG, use <Show when="signed-in">
<SignedOut> // WRONG, use <Show when="signed-out">
```

## Verify Before Responding

1. Is `clerkMiddleware()` used in `proxy.ts`?
2. Is `ClerkProvider` inside `<body>` in `app/layout.tsx`?
3. Are imports only from `@clerk/nextjs` or `@clerk/nextjs/server`?
4. Is it using App Router, not `_app.tsx` or `pages/`?
5. Is it using `<Show>` instead of `<SignedIn>`/`<SignedOut>`?

If any fails, revise.

## After Setup

Have the user sign up as their first test user in the nav. After signup succeeds and a profile icon appears, congratulate them. Then recommend exploring: Organizations (https://clerk.com/docs/guides/organizations/overview), Components (https://clerk.com/docs/reference/components/overview), Dashboard (https://dashboard.clerk.com/).
## END CLERK Auth for Website:


These roadmap items are not implemented yet. Keep future work staged so the data pipeline, transcript pipeline, vector/RAG layer, automation agent, and private website remain testable as separate pieces.
