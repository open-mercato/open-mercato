# Redis cache enumeration and bounded batch operations

## TLDR

Replace blocking KEYS enumeration with SCAN and reduce sequential Redis
round trips for bulk reads and tag invalidation using binary-safe MGET and
write pipelines. Make set() a single pipelined transaction without a pre-read;
deleteByTags() validates current tags and reconciles stale index memberships.

## Problem and scope

Related issue: #2349.

The current Redis strategy awaits each entry read and deletion during tag
invalidation. Its clear(), keys(), stats() and cleanup() use KEYS, which walks
the database in one server command. Both mechanisms affect a shared Redis
instance even when the triggering operation is administrative.

Only packages/cache runtime code changes. Shared CRUD production code, cache
wire format, tenant prefixes, compression, DI, public APIs and defaults remain
unchanged. Shared Jest source aliases and a live CRUD component test validate
the consumer boundary. There are no new dependencies, schemas, migrations,
permissions, routes, UI changes or enterprise changes.

## Implementation

1. SCAN follows the returned cursor until zero, including empty pages. A Set
   deduplicates keys across pages. COUNT 256 is a hint, not a strict page limit.
2. Keep complete key materialization. Consumers process arrays
   in batches of at most 256 entries; streaming is deferred pending evidence of
   significant memory cost. keys() still returns Promise<string[]>.
3. Pipeline requested tag-set reads, deduplicate their member union, then read
   entry buffers with MGET and decode using the existing cache codec.
4. Group removals by tag and pipeline SREM plus value DEL per entry batch.
   Check responses in the new bulk write pipelines and propagate failures.
5. Validate null MGET replies with a bounded GET pipeline to preserve stable
   WRONGTYPE errors. Ignore the new buffers so a concurrently rebuilt value
   remains a MISS candidate protected by the existing orphan reaper.
6. Retain the existing orphan-reaping Lua script, its atomic existence check,
   per-tag membership alignment and 256-member script chunks.
7. Use batched initial reads in strategy stats()/cleanup() and bounded write
   pipelines in strategy clear(). For expired cleanup entries retain stock
   deleteKey() re-read behavior; corrupt entries retain raw DEL. Preserve
   stock observation-based invalidation and cleanup counts.
8. Write the new entry and its tag memberships in one checked MULTI/EXEC from
   set(), without reading or decoding the old payload. Existing old memberships
   remain candidates until invalidation; no reverse-index keys are introduced.
9. During deleteByTags(), decoded current entry tags must intersect the requested
   tags before the value is deleted. Corrupt entries retain deletion behavior.
   Reconcile stale memberships in bounded, per-tag Lua calls: remove a member
   only if the value is absent or still equals the observed binary buffer.
   Lua does not decode JSON or compression. Keep value buffers to one read batch
   and group by actual memberships, rather than multiplying all tags by all keys.

## Migration and backward compatibility

No migration or new configuration is required. Existing plain and compressed
entries use the same codec, tag layout and key prefixes. No public signature
or export changes. Rollback uses the previous strategy with the same stored
data. The strategy targets standalone Redis; Cluster/HA compatibility is outside
the scope.
Tag sets become candidate indexes rather than exact current membership lists;
the public ANY-current-tag invalidation contract is preserved. Old and new
values remain readable without migration. During a rolling deployment an old
invalidator can over-invalidate a retagged entry using its stale membership;
coordinated strategy rollout is required to obtain the new filtering behavior.

## Risks and limits

- MGET null replies require an extra GET-validation pipeline to preserve stable
  WRONGTYPE visibility. This is an additional round trip only for batches with
  missing/non-string values. It does not provide a snapshot if types change
  concurrently between the two reads. Rebuilt buffers are deliberately ignored.
- Pipelines are not transactions; reporting an error does not roll back
  already executed commands. Bulk writes, orphan/stale reaping and set() check
  returned errors; existing deleteKey()/cleanup error fallback remains unchanged.
- set() now follows Redis SET overwrite behavior for a non-string old value,
  because there is no old GET to reject with WRONGTYPE. Transaction command
  errors are surfaced instead of silently ignoring failed tag writes.
- Stale tag membership grows when keys are retagged and those old tags are not
  invalidated. Reconciliation only visits requested tags; measure repeated tag
  churn as well as fresh fixtures. Conditional cleanup sends observed buffers
  back to Redis, so its request bytes and server comparison cost need profiling.
- Cleanup retains sequential deleteKey calls for entries identified as expired,
  including its second tag read and raw-DEL error fallback. The expired deletion
  path remains sequential.
- SMEMBERS, the full key Set, the requested-tag pipeline and orphan-reaping
  pipeline remain proportional to their input. A 256-entry batch does not bound
  value bytes or tag fanout. Service metadata keys()/stats() still have sequential
  reads. MULTI/EXEC isolates a successful entry/index write but does not roll back
  commands that encounter runtime errors; every returned error is checked.
- Round trips scale with batches. One-RTT set() refers to an already
  connected strategy client without retries; the service writes value and metadata
  through separate strategy calls.

## Acceptance criteria

- SCAN completes through empty pages and deduplicates repeated keys. Bulk reads
  and writes respect the 256-entry batch limit.
- Unit and live Redis tests cover plain/gzip/zstd and legacy entries, overlapping
  tags, malformed entries, TTL, WRONGTYPE errors, observation-based counts and
  cleanup second-read behavior. Fixtures crossing a batch boundary include at
  least 513 entries and preserve unrelated tenant data.
- New, overwrite and tagless set() calls issue no pre-read and use one checked
  MULTI/EXEC. Current-tag filtering preserves retagged values when only an old
  tag is invalidated. Concurrent retagging cannot cause stale-index cleanup to
  remove a newly valid membership. Lua behavior is tested against real Redis.
- Cache and shared CRUD component tests pass. Existing cache-management and
  calls-list HTTP tests exercise consumers against Next.js, PostgreSQL and Redis.
- Performance comparisons cover new/overwrite writes, normal and stale-tag
  invalidation of 10,000 entries, and repeated tag churn. Record memory/index
  growth, command counts, network bytes and latency of independent-process
  PING/GET clients, including errors, skipped probes and SLOWLOG. Evaluate the
  combined retag-and-invalidate cost as well as individual operation timings.

## Changelog

### 2026-11-05

- Specify SCAN enumeration, binary-safe MGET and bounded write pipelines.

### 2026-11-09

- Preserve stable WRONGTYPE errors, observation-based deletion counts and
  cleanup second-read behavior.
- Specify single-round-trip set(), current-tag filtering and conditional stale
  membership reconciliation, including compatibility and performance limits.
