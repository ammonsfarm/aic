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
