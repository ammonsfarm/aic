# Episode publication and processing contract

## Sources of truth

- Strapi owns public episode metadata, draft/published lifecycle, editorial revisions, and the publication outbox.
- The AIC PostgreSQL `episodes` row owns the stable processing identity used by transcripts, intelligence, vectors, Podtrac reconciliation, and private reporting.
- `trackId` is the immutable join key after first publication. It is at most 100 characters. Accepted values are SoundCloud numbers, `sa_<number>`, imported `wp-sermon:<number>` values, and safe first-party `cms_<name>` values.
- The operational `episode_processing_ownership` tombstone permanently binds one Track ID to one Strapi episode document. A different document cannot reuse that identity after unpublish or deletion. Existing operational rows fail closed unless they carry the trusted cutover `sourceFingerprint` baseline marker.
- Transcript, intelligence, and vector state is derived from operational tables. Editors do not set those states manually.

## Publication boundary

The supported post-cutover publication path is the private AIC editorial endpoint (`/api/editorial/episode/:documentId/publish`). In one Strapi PostgreSQL transaction it:

1. publishes the draft;
2. records the attributed immutable revision and audit event;
3. creates one `episode-processing-request` outbox row keyed to that publication revision.

No operational database, filesystem, MinIO, or pipeline call occurs in the publication request. If the outbox insert fails, the Strapi transaction fails with the publication.

The one-time cutover importer is a deliberate baseline exception: it may create already-published Strapi episodes directly only after its operational episode reconciliation proves those rows already exist. Routine editors must use the AIC custom editorial tools.

## Worker behavior

`aic-episode-publish-worker.timer` starts a serialized worker once per minute. The worker:

1. recovers stale claims and enforces a six-attempt bound;
2. claims one due outbox request, then revalidates that it remains the newest publication before every operational mutation and completion;
3. asserts or creates the permanent Track ID ownership tombstone before upserting the operational `episodes` row, without replacing existing useful metadata with blank Strapi values;
4. stages only managed MP3 audio, computes its SHA-256 fingerprint, and compares it with operational processing provenance;
5. skips an unchanged duplicate publication when coverage and provenance already match;
6. adopts complete pre-cutover coverage only when the audio came from the canonical private MinIO object;
7. when coverage is incomplete, invokes the existing idempotent `run_daily_podcast_ingest.py --track-id ... --skip-rss` path;
8. when audio changed or an editor explicitly retries a completed request, replaces the managed MinIO object, clears stale derived rows in one short transaction, and invokes the same runner with `--retranscribe`; the runner's Mistral limit is explicitly aligned with the editor's 250 MiB MP3 limit;
9. verifies operational coverage and records the request revision plus audio fingerprint before marking the outbox row complete.

Operational database reads use an autocommit connection so no transaction remains open while the external ingest runner uses its own connection. Upserts, derived-data resets, and provenance writes each use a short explicit transaction.

Retryable failures return to `queued` with exponential backoff. A request superseded by a newer publication is never requeued and cannot overwrite the newer request's status or provenance. The final bounded failure remains `failed` with a sanitized error. A content manager can inspect queued/running/completed/failed state on the episode editor and explicitly requeue a failed or completed request with an attributed audit event.

Remote audio URLs are never downloaded by this worker. Automatic processing requires a Strapi MP3 upload, verified legacy Pastor Wood media, or an existing private MinIO episode object. This avoids turning editorial input into an SSRF/download boundary.
