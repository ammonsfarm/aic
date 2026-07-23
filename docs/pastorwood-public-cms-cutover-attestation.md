# PastorWood public CMS cutover attestation

`PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED=true` is intentionally insufficient to make Strapi authoritative. The runtime and release preflight require immutable evidence that the exact reviewed cutover finished without a partial publication, early redirect, pending cache flush, or recorded failure.

## Evidence creation

Only the confirmed `--publish-reviewed` phase writes the evidence pair:

- `/mnt/storage/pastorwood-migration-20260722/pastorwood-public-cms-cutover-attestation.json`
- `/mnt/storage/pastorwood-migration-20260722/pastorwood-public-cms-cutover-attestation.json.sha256`

The location is fixed in production and is not configurable from the command line or environment. Phase two writes it only after it has revalidated the exact reviewed plan and mutation-manifest hash, confirmed every eligible publication, confirmed every redirect is active after all publications, flushed the signed local cache invalidation, and rechecked empty failure evidence. Dry runs, phase one, partial resumes, and failed runs never create new attestation JSON.

Publication actions carry a contiguous sequence. Any resumed evidence showing a redirect before all reviewed publications is rejected. The final JSON records the plan fingerprint, mutation-manifest SHA-256, full publication-manifest and action-evidence hashes, expected/completed action counts, expected/activated/verified redirect counts, cache-flush evidence, the full deployed Git revision, completion time, and an empty failure list.

The checksum is committed first and the JSON last, with both temporary files and the containing directory fsynced. The JSON is the commit marker: interruption between the two replacements leaves a mismatched pair that every reader rejects.

## Explicit activation

After a human independently reviews the final attestation and its checksum, bind these exact values in the canonical `/mnt/storage/aic/.env`:

```dotenv
PASTORWOOD_CUTOVER_ATTESTATION_SHA256=<sha256 of the exact attestation JSON bytes>
PASTORWOOD_CUTOVER_PLAN_FINGERPRINT=<attestation planFingerprint>
PASTORWOOD_CUTOVER_MUTATION_MANIFEST_SHA256=<attestation mutationManifestSha256>
PASTORWOOD_DEPLOYED_GIT_REVISION=<attestation deployedGitRevision, 40 lowercase hex characters>
PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED=true
```

Do not enable the boolean until the four bindings are present. The development environment configurator must continue to set `PASTORWOOD_PUBLIC_CMS_CUTOVER_ENABLED=false`; it does not activate or synthesize cutover evidence.

Run the launch preflight before restarting the web process:

```bash
NODE_ENV=production node scripts/check-pastorwood-launch-config.mjs \
  --env-file /mnt/storage/aic/.env \
  --subscription-worker-enabled 0
```

The preflight also compares `PASTORWOOD_DEPLOYED_GIT_REVISION` with the actual checked-out commit. Runtime validation rechecks the exact environment bindings, requires a regular non-symlink evidence pair under the immutable migration root, and caches only a stat-bound successful result. Missing, unreadable, changed, malformed, stale-plan, wrong-revision, partial, or symlink evidence keeps bootstrap continuity active.

Test-only JSON/path injection requires both `NODE_ENV=test` and the explicit test marker. Production rejects those controls.
