# Canonical episode draft sync and intelligence recovery

The scheduled 04:15 podcast ingest has two bounded follow-ups. They run only
after the existing daily ingest runner exits successfully, and any follow-up
failure makes the systemd service fail with a safe error.

## Canonical-to-Strapi draft sync

`scripts/sync_canonical_episode_drafts.py` reads recent episodes from the
existing canonical PostgreSQL database using only `/mnt/storage/aic/.env`. It
uses the management token from that same file and accepts only the private
Strapi endpoint `http://127.0.0.1:1337`.

The sync is create-only:

- it checks both draft and published Strapi state by permanent Track ID;
- any existing document is preserved without an update or baseline adoption;
- it resolves slug collisions with stable Track-ID-derived hashes and rechecks
  every Track ID and slug before the first create;
- it creates through `POST /api/editorial/episode` with the authenticated
  `canonical-episode-sync@pastorwood.local` system actor and an explicit
  revision note;
- it sets no schedule, never calls a publish endpoint, and verifies that every
  result exists only as a draft;
- it scans at most 100 recent canonical rows and creates at most 10 drafts per
  run. An overflow or malformed canonical identity fails before mutation.

Draft metadata comes from the canonical `episodes` row. Audio remains the
existing private MinIO object exposed through `/media/episodes/{trackId}`;
media is not copied into Strapi. The draft stores the canonical date, full
description, markup-free summary, bounded SEO metadata, canonical URL,
`aic:{trackId}` legacy identity, and a deterministic source fingerprint.

The default command is a read-only plan:

```bash
/mnt/storage/aic/.venv-pg/bin/python \
  /mnt/storage/aic/scripts/sync_canonical_episode_drafts.py \
  --env-file /mnt/storage/aic/.env
```

Applying the exact plan requires the explicit confirmation. This still creates
drafts only:

```bash
/mnt/storage/aic/.venv-pg/bin/python \
  /mnt/storage/aic/scripts/sync_canonical_episode_drafts.py \
  --env-file /mnt/storage/aic/.env \
  --apply \
  --confirm CREATE_MISSING_CANONICAL_EPISODE_DRAFTS
```

Rerun the read-only command immediately afterward. A successful idempotency
check reports no planned creates and lists the new document IDs under
`existingPreserved`.

## Failed intelligence recovery

`scripts/recover_failed_episode_intelligence.py` considers only
`episode_intelligence.status IN ('failed', 'rate_limited')` rows updated or
published in the last 14 days. A run handles at most four candidates and makes
one pipeline attempt. Every candidate must have both:

- a non-empty JSON transcript in
  `/mnt/storage/aic_podcast/transcript_cache/{trackId}.json`; and
- a canonical object larger than zero and no larger than 250 MiB at
  `local-minio/aic/podcasts/{trackId}.mp3`.

The recovery copies each cached transcript into a fixed private recovery
directory and stages MinIO audio exclusively into
`/mnt/storage/podcasts/{trackId}.mp3`. It refuses symlinks and collisions,
checks the MinIO object identity and enforces the fixed 250 MiB maximum before
copying, verifies the staged byte count, and tracks the staged inode so cleanup
cannot remove a file another process replaced.

It then invokes the existing
`/mnt/storage/aic_podcast/run_daily_podcast_ingest.py` with fixed argument
arrays, `shell=False`, the canonical database environment, explicit Track IDs,
and these required flags:

```text
--skip-rss --skip-upload --skip-transcribe --skip-rag
```

The runner therefore reuses the cached transcript, rebuilds episode
intelligence and intelligence vectors, and performs its normal verified audio
cleanup. The wrapper also removes any owned staging file left after a failure.
It exits nonzero unless every selected Track ID finishes with
`episode_intelligence.status='completed'` and at least one non-null
`episode_intelligence_vectors.embedding`.

The manual command uses the same production contract as the scheduled worker:

```bash
/mnt/storage/aic/.venv-pg/bin/python \
  /mnt/storage/aic/scripts/recover_failed_episode_intelligence.py \
  --env-file /mnt/storage/aic/.env \
  --podcast-env-file /mnt/storage/aic_podcast/.env
```

Do not substitute another database, Strapi URL, MinIO alias, podcast runner,
interpreter, transcript root, or audio staging root. Do not manually publish
drafts created by this maintenance path without the separate editorial review.

## Installation note

The daily service timeout is four hours and thirty minutes: two hours for the
normal ingest, then bounded time for draft sync and one intelligence recovery
attempt. Installing a revision with this change requires reinstalling the
versioned podcast systemd units through
`scripts/install-podcast-scheduled-workers.sh`; code checkout alone does not
change the installed unit. No PostgreSQL or Strapi migration is required.
