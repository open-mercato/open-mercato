# SPEC — Job deduplication in `@open-mercato/queue`

**Scope:** OSS
**Status:** Implemented (2026-09-08)
**Packages:** `@open-mercato/queue`

---

## TLDR

`EnqueueOptions` gains an optional `deduplication: { id, keepLastIfActive? }`. Repeated enqueues
sharing a key collapse into the one job already outstanding for it, and — with `keepLastIfActive` —
an enqueue that arrives while that job is *running* is parked rather than dropped, so exactly one
more run follows, carrying the latest payload.

Both strategies implement it. The async strategy hands the options to BullMQ, which has had this
natively since 5.x. The local strategy implements the same semantics on its file-backed store, so
development and integration runs coalesce the way production does.

## The problem

Nothing in the package could express "this job only needs to run once for this entity, no matter how
many triggers arrive". `EnqueueOptions` was `{ delayMs? }`. A chain of workers keyed on one entity —
recompute standings, recompute final standings, recompute placements, republish — therefore ran end
to end once per trigger. Ten score reports in a minute ran the chain ten times and republished three
to five times per score, all but the last of them computing state that was obsolete before it was
written.

The naive fix makes it worse. "Unique until finished" — deduplicate against any outstanding job,
which is what SQS FIFO and Cloud Tasks offer, and what BullMQ does when only `id` is given — drops a
trigger that lands while the job is running. The running job already read its input, so it finishes
on state that predates the dropped write, and the recomputed value stays wrong until some unrelated
trigger arrives. For a recompute-from-state job the requeue-if-active behaviour is the load-bearing
part, not the deduplication.

Mature systems all separate the two, along exactly this line — whether the uniqueness lock lives
until the job *starts* or until it *finishes*:

| System | Mechanism | Lock lifetime |
|---|---|---|
| BullMQ 5.x/6.x | `deduplication: { id, ttl?, extend?, replace?, keepLastIfActive? }` | `keepLastIfActive` keeps one active + one waiting per id, latest payload wins |
| Temporal | Signal-With-Start on a per-entity Workflow ID, `WorkflowIdConflictPolicy: USE_EXISTING` | signal lands on the running workflow, which loops once more |
| Sidekiq Enterprise | `unique_for:` with `unique_until: :start` / `:success` | `:start` queues exactly one more behind a running job |
| Oban | `unique: [period:, states: [...]]` | omitting `:executing` from `states` is requeue-if-active |
| SQS FIFO / Cloud Tasks | `MessageDeduplicationId` / task-name dedupe | dedupe only; a trigger during execution is lost |

## Contract

```ts
export type DeduplicationOptions = {
  id: string
  keepLastIfActive?: boolean
}

export type EnqueueOptions = {
  delayMs?: number
  deduplication?: DeduplicationOptions
}
```

- The key is scoped to one queue.
- `enqueue` returns the id of the job that will serve the caller's payload. When the enqueue was
  coalesced that is a job the caller did not create; when it was parked by `keepLastIfActive` it is
  the *running* job's id, and the follow-up carries the id minted for this call.
- `deduplication` is **best-effort per strategy**: an implementation that does not honour it MUST
  still enqueue the job. Degrade toward a duplicate run, never toward a dropped one.

### Why only two fields

BullMQ also offers `ttl`, `extend` and `replace`. They are deliberately unexposed:

- `ttl` is **ignored by BullMQ whenever `keepLastIfActive` is set** (`deduplicateJobWithoutReplace.lua`
  sets the key without `PX` in that branch). So the two shapes a coalescing chain wants — "coalesced
  recompute" and "debounced broadcast" — are the same call under BullMQ 6. `ttl` only bites in the
  dedupe-only mode, which is the mode this feature exists to avoid.
- Supporting `ttl` in the local strategy would require a deduplication key that outlives its job, and
  therefore a separate expiry index with its own pruning and orphan-reclamation rules — a subsystem
  bought for a mode nothing uses.
- All three are optional fields on an optional object, so adding them later is additive.

## Implementation

### Async strategy

The narrowed structural type on `BullQueueInterface.add` — the package keeps `bullmq` an optional
peer dependency and types it structurally — gains `deduplication`, and `enqueue` spreads the option
in conditionally. `deduplication: undefined` must never be emitted: BullMQ reads the key's presence
as intent. Nothing else changes; on a deduplicated add BullMQ's Lua returns the surviving job, and
`enqueue` already returns `job.id ?? jobData.id`.

`bullmq-deduplication-option.test.ts` asserts `keepLastIfActive` still exists in the installed
BullMQ's public type and that its Lua still gates the stored follow-up on the active list. Unknown
job options are ignored by BullMQ, so without this guard a rename would silently switch the feature
off with every other test still green — the same reasoning as `bullmq-abandoned-reasons.test.ts`.

### Local strategy

A local job stays in `queue.json` for its whole life, so **a record carrying `deduplicationId` is
the deduplication key**. No index, no expiry, nothing to orphan — dropping `ttl` is what buys this.

One thing cannot be derived from `queue.json`: whether a job is running *right now*. The in-memory
`inFlightJobIds` set cannot answer it for a producer, and producers are in other processes — the
documented topology is many producers and exactly one consumer. So the consumer publishes
`active.json`, listing the jobs it has started and not yet finalized on disk, written with an atomic
rename and without the queue lock (single writer). Producers read it inside their own locked segment.

- **`enqueue`** — unchanged fast path when no `deduplication.id` is given. Otherwise, inside one
  locked segment: no record carries the key → append; the record is leased active and the caller
  asked for `keepLastIfActive` → park the payload on that record as `deduplicationNext`, overwriting
  any previous one; anything else → **write nothing at all** and return the existing job's id.
  Rewriting `queue.json` on a plain drop would rename the file and wake the consumer's watcher for a
  job that does not exist, which is the work deduplication exists to remove.
- **`processBatch`** — publishes the lease before each handler runs, naming every job started so far
  in the batch. It names all of them rather than only the current one because no record leaves
  `queue.json` until the batch's closing write: a producer that saw a finished-but-still-stored job
  as idle would drop an enqueue that job can no longer act on. On completion *or* attempt exhaustion
  the record is removed and any parked follow-up is appended in the same write, so there is never a
  moment when a burst could produce a third job for one key. A retry leaves the record, its key and
  its parked follow-up untouched, matching BullMQ, whose retry paths contain no deduplication code.
- **Retry bookkeeping** changed from whole-record snapshots to patches. The pre-run snapshot no
  longer reflects the record by the time the batch closes — a producer may have parked a follow-up on
  it — and rewriting from the snapshot would have discarded that enqueue.
- **Crash recovery** — a consumer starting up clears any lease it finds. This strategy admits exactly
  one consumer per queue, so a lease present at that moment belongs to a run that will never finish;
  the jobs it named are still stored and simply run again. Ageing leases out instead would require
  guessing a ceiling on how long a handler may legitimately take. For a consumer that never restarts,
  `enqueue` additionally checks the lease owner's pid on the same host, with a time ceiling for the
  unsupported cross-host case.
- **`getJobCounts().active`** now reports the lease intersected with the stored jobs, instead of the
  hard-coded `0`, and `waiting` discounts them. Intersecting keeps a lease naming an already-cleared
  job from inflating the count or pushing `waiting` negative.
- **Failure handling for `active.json` is fail-open** — unparsable content is logged and discarded,
  the mirror image of `queue.json`'s fail-closed quarantine. A lease holds nothing recoverable and
  the cost of losing one is a duplicate run, which the queue's at-least-once contract already permits;
  refusing to enqueue over a damaged lease would turn a cosmetic file into an outage.

`pending-probe.ts` is deliberately untouched. It reads `queue.json` directly and reports `active: 0`;
teaching it about leases would change what `ready` means to the lazy worker supervisor's spawn and
idle-shutdown decisions. An active job already counts as `ready` there today.

## Migration & Backward Compatibility

Additive throughout — nothing to migrate, nothing deprecated, no `UPGRADE_NOTES.md` entry.

- `EnqueueOptions.deduplication` is a new optional field on an exported STABLE type, recorded in
  `BACKWARD_COMPATIBILITY.md` §2. Every existing call site compiles and behaves identically.
- `queue.json` records gain two optional fields; files written by an older build parse unchanged and
  are treated as ordinary jobs. `active.json` is created on demand, and a missing one reads as an
  empty lease.
- Downgrading is safe: an older build round-trips the extra fields harmlessly and ignores
  `active.json`, so deduplication stops working rather than dropping enqueues.
- BullMQ's `ttl`, `extend` and `replace` can be added later as optional fields without breaking
  anyone.

## Verification

Coverage is asymmetric by design, because the two strategies carry different risk. The local
strategy holds all the new logic and is tested against its real implementation. The async strategy is
a one-line pass-through, so its unit tests run against the usual BullMQ mock and assert only that the
options arrive untouched — the risk there is not our code but BullMQ's behaviour changing underneath
it, which two other tests address: `bullmq-deduplication-option.test.ts` reads the *installed* BullMQ
and fails on a rename, and `async.deduplication.redis.test.ts` runs the burst against a real server.
The latter is opt-in (`QUEUE_TEST_REDIS_URL`) because nothing else in the repo needs one: `bullmq` is
an optional peer dependency, every other suite mocks Redis, and the Playwright lane runs
`QUEUE_STRATEGY=local`. Removing the pass-through turns it red, so it has teeth.

`yarn workspace @open-mercato/queue test` — 126 tests, plus 2 skipped without a Redis URL. The local
deduplication suite covers: a burst of ten
collapsing to one job and one run; separate keys and undeduplicated jobs untouched; the key released
on completion and on attempt exhaustion but surviving a retry; `keepLastIfActive` producing exactly
one more run with the latest payload, driven from a second queue instance so the pass proves the
active state was read from disk; the follow-up keeping its producer's id; an enqueue during a run
being dropped without `keepLastIfActive`, and parking nothing when the twin is merely waiting; the
lease being published, cleared, and ignored when its owner is dead or when a consumer starts; a
dropped enqueue leaving `queue.json`'s inode and mtime untouched; an unparsable lease failing open;
and records written before this feature still processing.
