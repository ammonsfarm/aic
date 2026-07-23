# Editorial scheduling

Pages, posts, and episodes can be assigned a UTC publication time in the custom content manager. Saving keeps the item as a draft. The scheduled-publication timer checks Strapi every minute and publishes due drafts through the same locked editorial workflow used for manual publication.

## Safety contract

- The worker never connects to PostgreSQL. It uses the scoped Strapi management API.
- Every publication includes the exact `updatedAt` value read from Strapi. A later editor save makes the queued attempt stale and Strapi rejects it before publishing.
- Strapi clears `scheduledFor` inside the editorial transaction before publishing. Repeated or overlapping worker runs therefore cannot create a second scheduled publication revision.
- Manual publication clears a pending schedule.
- Archived content and future schedules are rejected.
- Scheduled episode publication uses the existing durable episode-processing outbox after the publication revision is recorded.
- Before each publication request, the worker durably records pending public-cache invalidation. It clears that evidence only after the exact local signed route confirms a 2xx JSON response with `revalidated: true`.
- A timer run retries a pending or crash-claimed invalidation before querying for new work. Concurrent flushers are serialized, and a newer marker created during a request is not deleted with the older claim.
- A run considers at most 25 entries by default and never more than 100.

## Service

`aic-scheduled-publication-worker.timer` runs `scripts/publish_scheduled_strapi_content.mjs` as `ammonsfarm`. The service reads URL, token, actor, and revalidation secret values directly from `/mnt/storage/aic/.env`; inherited process values cannot override that file. It requires the same private Strapi URL and scoped management token as the content manager. `SCHEDULED_PUBLICATION_ACTOR_EMAIL` is optional; its default is the non-human audit identity `scheduled-publication@pastorwood.local`. Its private systemd state directory is `/var/lib/aic-scheduled-publication`.

Install or refresh the timer with:

```bash
bash scripts/install-scheduled-publication-worker.sh
```

Installation and activation happen only during an approved deployment. Building or testing this repository does not install or start the timer.

## Acceptance checks after deployment

1. Save a future-dated draft and confirm it remains private before the UTC deadline.
2. Edit the draft in a second session; confirm an older save or publication attempt is rejected.
3. Confirm the timer publishes the due draft once and clears its scheduled time.
4. Confirm a scheduled episode creates exactly one durable processing request.
5. Confirm the local signed revalidation route succeeds and no `cache-revalidation-pending.json` or `.inflight` marker remains.
6. Review the editorial revision and event attribution for the scheduled-publication service actor.
