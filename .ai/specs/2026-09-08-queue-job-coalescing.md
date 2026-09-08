# SPEC — Job coalescing in `@open-mercato/queue`

**Scope:** OSS
**Status:** Implemented (2026-09-08)
**Packages:** `@open-mercato/queue`

---

## TLDR

`EnqueueOptions` gains an optional `coalesce: { key }`, and both queue option types gain a
`coalesceBy(payload)` resolver so the key can be declared once where the queue is built. Repeated
enqueues sharing a key collapse into the one job already outstanding for it, and an enqueue that
arrives while that job is *running* is parked rather than dropped, so exactly one more run follows,
carrying the latest payload.

The guarantee, stated once: **the last enqueue for a key always gets a run that observes it.**

Both strategies implement it. The async strategy maps the key onto BullMQ's deduplication with
`keepLastIfActive`, which BullMQ has had natively since 5.x. The local strategy implements the same
semantics on its file-backed store, so development and integration runs coalesce the way production
does.

## The problem

Nothing in the package could express "this job only needs to run once for this entity, no matter how
many triggers arrive". `EnqueueOptions` was `{ delayMs? }`. So a job that recomputes something from
current state — an order total, a cached projection, a search document, a realtime broadcast — ran
once per trigger, and a chain of such jobs ran end to end once per trigger. Ten writes to one entity
in a minute produced ten runs of everything downstream, all but the last computing state that was
obsolete before it was written.

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
export type CoalesceOptions = { key: string }
export type CoalesceKeyResolver<T> = (payload: T) => string | null | undefined

export type EnqueueOptions = {
  delayMs?: number
  coalesce?: CoalesceOptions
}

// on both LocalQueueOptions<T> and AsyncQueueOptions<T>
coalesceBy?: CoalesceKeyResolver<T>
```

- The key is scoped to one queue. An explicit `coalesce` overrides the queue's `coalesceBy`; a
  resolver returning `null`/`undefined` leaves that payload uncoalesced.
- `enqueue` returns the id of the job that will serve the caller's payload. When the enqueue was
  collapsed into an outstanding job that is a job the caller did not create; when it was parked
  behind a running job it is the *running* job's id, and the follow-up carries the id minted for
  this call.
- Coalescing is **best-effort per strategy**: an implementation that does not honour it MUST still
  enqueue the job. Degrade toward a duplicate run, never toward a dropped one. But the guarantee
  itself is not advisory — an implementation MUST NOT discard an enqueue arriving while a job for
  its key is running.

### Why there is no drop-the-duplicate mode, and no `ttl`/`extend`/`replace`

BullMQ's bare `deduplication: { id }` discards an enqueue that lands mid-run. Every system in the
table above defaults to that — verified for BullMQ (`keepLastIfActive` false) and
[Oban](https://hexdocs.pm/oban/unique_jobs.html) (`states: :successful`, which includes executing).
They are general-purpose primitives; this package documents one dominant use case, and for it that
default is a silent correctness bug. The failure is asymmetric — a lost trigger leaves state stale
until something unrelated happens along, while a redundant run costs milliseconds and is something
the package already requires workers to tolerate, since retries can duplicate a run anyway. When one
side of a default is silent corruption, the default picks itself; and once it is picked, the flag
has no reason to exist.

The name follows. "Deduplication" means *discard the duplicate*, which is precisely the behaviour
being rejected; "coalesce" means merge them into one run. The cost is losing grep-parity with
BullMQ's vocabulary, paid because the local strategy is a full implementation rather than a shim, so
BullMQ's names are not the canonical truth here. A comment on the type points anyone who needs it at
`keepLastIfActive`.

BullMQ's remaining fields are unexposed for a separate reason:

- `ttl` is **ignored by BullMQ whenever `keepLastIfActive` is set** (`deduplicateJobWithoutReplace.lua`
  sets the key without `PX` in that branch). Since we always set it, `ttl` could never do anything.
- Supporting `ttl` in the local strategy would require a key that outlives its job, and therefore a
  separate expiry index with its own pruning and orphan-reclamation rules — a subsystem bought for a
  mode nothing uses.
- All are optional fields on an optional object, so adding them later is additive.

### Why `coalesceBy` on the queue

A key passed at every call site is a key one call site can forget, and the failure is invisible: the
enqueue succeeds, the burst just stops collapsing. Declaring it where the queue is built removes the
class rather than documenting around it — which is what the originating ticket asked for on the
consumer side ("set the option on the queue getters … so no call site can forget it").

## Implementation

### Async strategy

The narrowed structural type on `BullQueueInterface.add` — the package keeps `bullmq` an optional
peer dependency and types it structurally — gains `deduplication`, and `enqueue` spreads it in only
when a key resolves, as `{ id: key, keepLastIfActive: true }`. `deduplication: undefined` must never
be emitted: BullMQ reads the key's presence as intent. Nothing else changes; on a coalesced add
BullMQ's Lua returns the surviving job, and `enqueue` already returns `job.id ?? jobData.id`.

`bullmq-deduplication-option.test.ts` asserts `keepLastIfActive` still exists in the installed
BullMQ's public type and that its Lua still gates the stored follow-up on the active list. Unknown
job options are ignored by BullMQ, so without this guard a rename would silently switch the feature
off with every other test still green — the same reasoning as `bullmq-abandoned-reasons.test.ts`.

### Local strategy

A local job stays in `queue.json` for its whole life, so **a record carrying `coalesceKey` is
the coalescing key**. No index, no expiry, nothing to orphan — dropping `ttl` is what buys this.

One thing cannot be derived from `queue.json`: whether a job is running *right now*. The in-memory
`inFlightJobIds` set cannot answer it for a producer, and producers are in other processes — the
documented topology is many producers and exactly one consumer. So the consumer publishes
`active.json`, listing the jobs it has started and not yet finalized on disk, written with an atomic
rename and without the queue lock (single writer). Producers read it inside their own locked segment.

- **`enqueue`** — unchanged fast path when no key resolves. Otherwise, inside one locked segment: no
  record carries the key → append; the record is leased active → park the payload on it as
  `coalesceNext`, overwriting any previous one; the record exists but is only waiting → **write
  nothing at all** and return its id. That last case is the common one, and rewriting `queue.json`
  there would rename the file and wake the consumer's watcher for a job that does not exist, which
  is the work coalescing exists to remove.
- **`processBatch`** — publishes the lease before each handler runs, naming every job started so far
  in the batch. It names all of them rather than only the current one because no record leaves
  `queue.json` until the batch's closing write: a producer that saw a finished-but-still-stored job
  as idle would drop an enqueue that job can no longer act on. On completion *or* attempt exhaustion
  the record is removed and any parked follow-up is appended in the same write, so there is never a
  moment when a burst could produce a third job for one key. A retry leaves the record, its key and
  its parked follow-up untouched, matching BullMQ, whose retry paths contain no deduplication code.
- **Key resolution** is shared by both strategies in `src/coalescing.ts`, so `coalesceBy` and the
  per-enqueue override cannot drift apart between them.
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

- `EnqueueOptions.coalesce` and `coalesceBy` on both queue option types are new optional fields on
  exported STABLE types, recorded in `BACKWARD_COMPATIBILITY.md` §2. Every existing call site
  compiles and behaves identically.
- `LocalQueueOptions`, `AsyncQueueOptions`, `QueueOptions` and `CreateQueueConfig` gained a payload
  type parameter so `coalesceBy` can be typed. Each defaults to `unknown`, so every bare reference
  keeps resolving exactly as before.
- `queue.json` records gain two optional fields; files written by an older build parse unchanged and
  are treated as ordinary jobs. `active.json` is created on demand, and a missing one reads as an
  empty lease.
- Downgrading is safe: an older build round-trips the extra fields harmlessly and ignores
  `active.json`, so coalescing stops working rather than dropping enqueues.
- BullMQ's `ttl`, `extend` and `replace` can be added later as optional fields without breaking
  anyone.

## Verification

Coverage is asymmetric by design, because the two strategies carry different risk. The local
strategy holds all the new logic and is tested against its real implementation. The async strategy is
a one-line pass-through, so its unit tests run against the usual BullMQ mock and assert only that the
options arrive untouched — the risk there is not our code but BullMQ's behaviour changing underneath
it, which two other tests address: `bullmq-deduplication-option.test.ts` reads the *installed* BullMQ
and fails on a rename, and `async.coalescing.redis.test.ts` runs the burst against a real server.
The latter is opt-in (`QUEUE_TEST_REDIS_URL`) because nothing else in the repo needs one: `bullmq` is
an optional peer dependency, every other suite mocks Redis, and the Playwright lane runs
`QUEUE_STRATEGY=local`. Removing the pass-through turns it red, so it has teeth.

CI supplies the URL through a Redis service on the existing `test` job, so the suite runs there as
part of the ordinary queue tests rather than in a lane of its own. `documents-multi-instance` is not
the precedent to copy here despite the surface similarity: it needs its own Docker-capable runner
because it starts its containers with testcontainers, whereas one plain service container is
something the shared job can declare — as two other workflows already do on the same runner.

`yarn workspace @open-mercato/queue test` — 131 tests, of which 2 skip without a Redis URL. The
local coalescing suite covers: a burst of ten collapsing to one job and one run; separate keys and
uncoalesced jobs untouched; the key released on completion and on attempt exhaustion but surviving a
retry; an enqueue during a run producing exactly one more run with the latest payload, driven from a
second queue instance so the pass proves the active state was read from disk rather than from the
in-process in-flight set; the follow-up keeping its producer's id; nothing parked when the twin is
merely waiting; a queue-level `coalesceBy` keying every enqueue, returning `null` to opt a payload
out, and losing to an explicit per-enqueue key; the lease being published, cleared, and ignored when
its owner is dead or when a consumer starts; a coalesced enqueue leaving `queue.json`'s inode and
mtime untouched; an unparsable lease failing open; and records written before this feature still
processing.
