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
