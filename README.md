# aic
aic podcast metrics and podcast episode data

## Server deployment

The web app is currently served on **port `8087`** on the shared farm host.

To deploy updates from this repo to the server in one command, run:

```bash
REMOTE_HOST=farm \
REMOTE_USER=ammonsfarm \
REMOTE_DIR=/mnt/storage/aic \
REMOTE_BRANCH=main \
REMOTE_SERVICE=aic-web.service \
REMOTE_PORT=8087 \
./scripts/deploy-farm-web.sh
```

After deploy, validate with:

```bash
ssh ammonsfarm@farm "curl -I http://127.0.0.1:8087/"
```

For Cloudflare Zero Trust, point the tunnel to `http://127.0.0.1:8087` (or `http://192.168.1.141:8087` from your network edge path).

### PastorWood public launch gates

The canonical `/mnt/storage/aic/.env` is authoritative for public launch state. Development uses `PASTORWOOD_LAUNCH_STAGE=development`, exact origin `https://aic.ammonsfarm.org`, and mandatory `PASTORWOOD_ALLOW_INDEXING=false`. The production hostname is accepted only with the explicit `production-cutover` stage. `PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED=false` keeps all public pages, structured collections, site settings, redirects, sitemap entries, and CMS media on bootstrap continuity while editors prepare and preview Strapi. CMS-only dynamic slugs are intentionally hidden in this mode because they have no reviewed bootstrap equivalent. Enable the gate only after the reviewed publication batch is complete. Public devotional signup also defaults off with `PASTORWOOD_SUBSCRIPTIONS_ENABLED=false`; it becomes effective only when the public CMS cutover, published CMS switch, and all Mailchimp, webhook-signing, rate-limit, and unsubscribe settings are ready. The deploy check rejects an enabled runtime gate when the provider worker install toggle is off or provider configuration is incomplete. It never enables signup merely because secrets exist.

After cutover, public Strapi reads use a 1.5-second timeout and a process-local 30-second outage circuit by default (`STRAPI_PUBLIC_FETCH_TIMEOUT_MS` and `STRAPI_PUBLIC_CIRCUIT_COOLDOWN_MS`). One unavailable public probe sends subsequent public readers directly to continuity data until a single recovery probe succeeds. Protected content-management requests do not use this circuit, and successful empty published responses remain authoritative.

Scheduled and reviewed-cutover publications durably mark cache invalidation before changing public state, then call only the signed local Next route on port `8087`. Failed or interrupted invalidation remains pending and is retried before later publication work. See `docs/strapi-cache-revalidation.md` and `docs/editorial-scheduling.md`.

Giving and donor-account links also fail closed. `PASTORWOOD_DONATION_URL` and `PASTORWOOD_DONOR_DASHBOARD_URL` must point to separately allowlisted external HTTPS hosts. A `pastorwood.org` URL is a self-link after cutover and is never treated as a payment or account provider.

## Protected episode audio

Episode pages use the authenticated route `/api/audio/[trackId]` for MP3 playback. The route streams private MinIO objects from `local-minio/aic/podcasts/` through the Next app, so browsers do not receive public GCS links.

The service runs as `ammonsfarm` and uses that user's `mc` alias by default:

- `AIC_AUDIO_MC_BIN=/usr/local/bin/mc`
- `AIC_AUDIO_MC_ALIAS=local-minio`
- `AIC_AUDIO_BUCKET=aic`
- `AIC_AUDIO_PREFIX=podcasts`

## Transcript segment sync

The RAG table `transcript_chunks` is optimized for retrieval snippets. The readable episode transcript uses source-preserving Gemini JSON segments loaded into:

- `transcript_segments`: timed speaker/text rows for the audio-following transcript reader.
- `transcript_references`: episode-level and segment-level Bible/other references for footnotes and reference panels.

On the server, the historical transcript JSON source is:

```text
/home/ammonsfarm/gemini-transcribe
```

After migrations are applied, load or refresh the readable transcript tables with:

```bash
ssh ammonsfarm@farm "cd /mnt/storage/aic && python3 sync_transcript_segments_to_postgres.py --transcript-dir /home/ammonsfarm/gemini-transcribe"
```

## Transcript edit queue

Episode pages can queue transcript corrections from the audio-following reader. The authenticated API route `/api/episodes/[trackId]/transcript-edits` writes pending rows to `transcript_edit_requests` with the source table, segment id, original text, edited text, editor id, and `needs_revectorization=true`.

A backend worker consumes `status='pending'` rows, applies the correction to `transcript_segments` or `transcript_chunks`, updates matching `transcript_chunks` text, refreshes affected chunk embeddings when `OPENAI_API_KEY` is available, then marks the request `applied` or `failed`.

```bash
.venv-pg/bin/python scripts/apply_transcript_edit_requests.py --env-file .env --limit 25
```

On the farm host this is installed as a systemd timer:

```bash
sudo systemctl status aic-transcript-edit-worker.timer
sudo systemctl status aic-transcript-edit-worker.service
```

The timer runs every two minutes and processes up to twenty-five queued edits per run.

## Strapi episode publication queue

Publishing an episode through the private AIC content manager records a durable Strapi outbox row in the same editorial transaction. `aic-episode-publish-worker.timer` bridges that row into the operational `episodes` table and the existing per-track transcript, intelligence, and vector pipeline with bounded retries, stale-claim recovery, and SHA-256 audio provenance so duplicate publications are cheap while changed audio is retranscribed. Processing state is derived and read-only in the editor; it is not an editable episode field. See `docs/episode-publication-pipeline.md` for the source-of-truth and audio-staging contract.
