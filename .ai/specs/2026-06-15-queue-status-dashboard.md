# Queue Status Dashboard — Payload-Free Queue Health & Failed-Job Visibility

- **Status:** Draft (deferred — not yet implemented)
- **Scope:** OSS
- **Owner module:** `configs` (admin surface) + `@open-mercato/queue` (introspection contract)
- **Tracking issue:** _filled in after issue creation_

## TLDR

Add a **read-only Queue Status** admin surface that shows, per registered queue, the
current job counts by state (waiting / active / completed / failed / delayed) plus a
**bounded, payload-free** list of recent failed jobs (id, queue, worker id, error/reason,
attempts, failed-at). It must be **safe to open against very large queues**: it never
enumerates the whole queue and **never loads or renders job payloads** (`job.data`),
which can contain tenant-sensitive data. Counts come from aggregate APIs
(`Queue.getJobCounts()` / BullMQ `getJobCounts`), and the failed-job list is fetched in a
small bounded window with the payload stripped server-side. Works for both `local`
(file-based) and `async` (BullMQ/Redis) strategies, degrading gracefully where the local
strategy cannot supply a state.

## Open Questions

_None blocking._ The design reuses the existing `configs` system-status surface and the
existing `Queue.getJobCounts()` contract, so no architecture-blocking unknowns remain. Two
**deferred decisions** are explicitly out of scope for the first cut and tracked as
non-goals below (mutating actions; cross-tenant aggregation). If the maintainer wants
either folded into Phase 1, that changes the ACL/seam design — flag before implementation.

## Problem Statement

Operators currently have **no in-app way** to see whether background processing is healthy.
The only signals are:

- The CLI worker logs (`[worker] …`, `[queue:<name>] Job … failed: …`).
- The lazy-worker pending probe (`packages/queue/src/pending-probe.ts`), which is internal
  plumbing, not an operator view.
- Direct Redis/BullMQ inspection or reading `.mercato/queue/<name>/state.json` by hand.

When jobs pile up or start failing (a dead external dependency, a poisoned message, a
Redis outage that silently degraded the cache to memory), there is no first-class place to
notice it. The existing `configs` **System Status** page already centralizes environment
and cache health (`/backend/config/system-status`), so it is the natural home for queue
health too.

The hard constraint is **safety at scale and tenant-data safety**:

1. A production queue can hold **hundreds of thousands** of jobs. The view MUST NOT
   enumerate them — doing so would hammer Redis (or read a huge local file) and can OOM the
   request. Only **aggregate counts** and a **small bounded window** of recent failures are
   allowed.
2. A job's payload (`job.data`) routinely carries **tenant-scoped, potentially
   encrypted-at-rest or PII** content (entity ids, emails, document bodies, sync records).
   The status surface MUST NOT expose payloads. Only **non-sensitive status metadata**
   (counts, ids, worker id, error message/reason, attempt count, timestamps) may leave the
   server.

## Proposed Solution

### Architecture overview

```
┌──────────────────────────────────────────────────────────────────┐
│ configs module (admin surface)                                     │
│   backend/config/queues-status/page.tsx   ──renders──▶ QueueStatusPanel │
│   api/queues-status/route.ts  (GET, requireFeatures: queues_status.view)│
│        │ resolves DI 'createQueue' + worker registry                │
│        ▼                                                            │
│   lib/queue-status.ts  buildQueueStatusSnapshot()                  │
│        │ enumerate registered queues (dedupe worker descriptors)    │
│        │ per queue: getJobCounts() + getFailedJobsSummary(limit)    │
│        ▼ returns sanitized snapshot (NO job.data)                  │
└────────────────────────────┼───────────────────────────────────────┘
                             │ uses additive contract
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ @open-mercato/queue (introspection contract — ADDITIVE only)       │
│   Queue.getJobCounts()  (exists) → add optional `delayed`          │
│   Queue.getFailedJobsSummary?(limit, offset)  (NEW, optional)      │
│     async strategy: BullMQ getJobs(['failed'], 0, limit) → strip   │
│     local strategy: read failed entries from state, bounded        │
└──────────────────────────────────────────────────────────────────┘
```

Cross-module rule compliance: the admin surface lives in `configs`, the introspection
contract lives in `@open-mercato/queue`. The `configs` route depends on the queue package
through its **public contract** (the `Queue` interface + the worker registry), not on any
queue internals — consistent with "NO direct ORM relationships between modules" and
"depend on public contracts" rules. There is no new database entity and no migration.

### Queue enumeration

Registered queues are discovered the same way the CLI worker discovers them
(`packages/cli/src/mercato.ts`): collect every module `WorkerDescriptor`, then
`[...new Set(allWorkers.map(w => w.queue))]`. The snapshot builder reuses the worker
registry export (`@open-mercato/queue` → `worker/registry`) so the dashboard and the worker
runtime always agree on the queue list. For each queue we also surface the declared worker
ids and concurrency so an operator can correlate a backlog with a worker.

### Counts (the always-safe path)

For every queue, call the existing `Queue.getJobCounts()`:

- **async (BullMQ):** maps to `queue.getJobCounts('waiting','active','completed','failed', …)`
  — an O(1)-ish aggregate, safe at any size.
- **local:** returns waiting/completed derived from the last-processed id and a failed
  count from `state.json`. Fidelity is lower; the snapshot marks local queues with a
  `fidelity: 'partial'` flag so the UI can label them honestly rather than implying exact
  live counts.

`getJobCounts()` currently returns `{ waiting, active, completed, failed }`. We add an
**optional** `delayed` field (additive — see Backward Compatibility). When a strategy can't
supply `delayed`, it is omitted and the UI hides that column for that queue.

### Failed jobs (bounded, payload-free)

A new **optional** method on the `Queue` contract:

```ts
getFailedJobsSummary?(limit: number, offset?: number): Promise<FailedJobSummary[]>
```

```ts
// Sanitized — intentionally OMITS job.data / payload.
type FailedJobSummary = {
  id: string
  queue: string
  workerId?: string        // best-effort, when derivable
  failedReason?: string    // BullMQ failedReason / local error message, truncated server-side
  attemptsMade?: number
  failedAt?: number        // epoch ms
}
```

- **async (BullMQ):** `queue.getJobs(['failed'], 0, limit - 1)` then map **only** the
  allow-listed fields above. `job.data` is never read into the response. `failedReason` is
  truncated to a fixed max length (e.g. 500 chars) server-side to avoid leaking large
  stack/context blobs.
- **local:** read the bounded set of failed entries recorded in `state.json` (the local
  strategy already tracks `failedCount` / attempt data), capped at `limit`.
- `limit` is hard-capped server-side (e.g. ≤ 50, default 20). The route ignores/clamps any
  client-supplied value above the cap. There is **no "show payload" affordance** anywhere.

If a strategy does not implement `getFailedJobsSummary`, the snapshot returns counts only
and the UI shows "failed details unavailable for this strategy".

### Admin surface

- New backend page `configs/backend/config/queues-status/page.tsx` rendering a
  `QueueStatusPanel` component, mirroring the existing `SystemStatusPanel` pattern and using
  `Page`/`PageBody` from `@open-mercato/ui/backend/Page`.
- The panel reads from the new API route via `apiCall` (never raw `fetch`), shows a per-queue
  card/table with the state counts using **Design System status tokens** (e.g. failed uses
  `text-status-danger-*` / `bg-status-danger-*`, never hardcoded `text-red-*`), and a
  collapsible bounded failed-jobs table.
- Add a link/section from the existing System Status page (or a sibling nav entry under
  `config`) and an `InjectionSpot` (e.g. `configs.queues_status:details`) for extension.
- All strings via `useT()` / `resolveTranslations()`; no hardcoded user-facing copy.
- Manual auto-refresh only (button or a modest interval). Because every refresh is just
  aggregate counts + a tiny bounded window, polling stays cheap even on huge queues.

### Access control

New immutable feature id in `configs/acl.ts`: `configs.queues_status.view` (read). The route
guards `GET` with `requireFeatures: ['configs.queues_status.view']`, matching how
`system-status` guards `configs.system_status.view`. No mutating endpoint in Phase 1, so no
`configs.manage`-style write feature is added yet.

### Tenant scoping

Queues in Open Mercato are **infrastructure-level**, not tenant-partitioned — a single
BullMQ/local queue is shared across tenants and jobs carry their own tenant scope in the
payload (which we deliberately never read). Therefore the dashboard is an
**operator/admin** view gated by a platform feature, and it surfaces **aggregate counts
only** — never per-tenant payload data — so it cannot leak cross-tenant content. The spec
explicitly does NOT add per-tenant queue filtering in Phase 1 (it would require reading
payloads to attribute jobs to tenants, which violates the core safety constraint). If
per-tenant attribution is ever needed, it must come from queue-level metadata/tags, not
payload inspection — tracked as a non-goal.

## Phasing (stories)

### Phase 1 — Introspection contract (queue package)
Additive, payload-free introspection on the `Queue` contract for both strategies.

### Phase 2 — Status API + snapshot builder (configs module)
`buildQueueStatusSnapshot()` + guarded `GET /api/configs/queues-status` returning the
sanitized snapshot.

### Phase 3 — Admin UI
`QueueStatusPanel` + page + nav/injection + i18n + DS-token styling.

### Phase 4 (non-goal / follow-up) — Mutating actions
Optional retry / remove-failed actions (own write feature, optimistic-lock-free since jobs
are not user-editable entities, idempotent, audited). Explicitly **out of scope** here.

## Implementation Plan (testable Steps)

1. **Queue contract — counts.** Add optional `delayed?: number` to the `getJobCounts()`
   return type in `packages/queue/src/types.ts`. Implement it in `async.ts`
   (`getJobCounts('waiting','active','completed','failed','delayed')`) and omit it from
   `local.ts`. _Test:_ unit test both strategies' `getJobCounts()` shape.
2. **Queue contract — failed summary.** Add optional `getFailedJobsSummary?(limit, offset?)`
   to the `Queue` interface + `FailedJobSummary` type (no `data` field). Implement in
   `async.ts` (BullMQ `getJobs(['failed'],0,limit-1)` → allow-list map + reason truncation)
   and `local.ts` (bounded read from `state.json`). _Test:_ unit test that the returned
   objects contain **no payload key**, respect the `limit` cap, and truncate `failedReason`.
3. **Snapshot builder.** `configs/lib/queue-status.ts` → `buildQueueStatusSnapshot()`:
   enumerate queues from the worker registry, resolve `createQueue` via DI per strategy,
   call counts + failed-summary, assemble `QueueStatusSnapshot` with a `fidelity` flag for
   local. zod schema for the snapshot in `configs/lib/queue-status.types.ts` (derive TS via
   `z.infer`). _Test:_ unit test enumeration/dedup + sanitization (asserts no `data`).
4. **API route.** `configs/api/queues-status/route.ts` `GET` guarded by
   `requireFeatures: ['configs.queues_status.view']`; clamp `limit` server-side; return the
   snapshot; map errors to a translated 500 (mirror `system-status/route.ts`). Add OpenAPI
   doc entries. _Test:_ integration test on `/api/configs/queues-status` (auth required,
   feature gate, payload-free body, `limit` clamp).
5. **ACL.** Add `configs.queues_status.view` to `configs/acl.ts`; sync to the relevant role
   features in `setup.ts`. Run `yarn generate`.
6. **UI panel.** `QueueStatusPanel` (DS status tokens, no hardcoded colors), `apiCall`,
   `LoadingMessage`/`ErrorMessage`, i18n keys, bounded failed-jobs table with **no payload
   column**. _Test:_ component test asserts the failed table renders only allow-listed
   fields.
7. **Page + nav + injection.** `backend/config/queues-status/page.tsx`, nav/menu entry under
   `config`, `InjectionSpot` `configs.queues_status:details`, link from System Status.
8. **i18n + checks.** Add locale keys; run `yarn i18n:check-hardcoded`. Prefix any internal
   `throw`/`toast` with `[internal]`.

## Integration Coverage

**Affected API paths**
- `GET /api/configs/queues-status` — auth required (401 without session); feature gate
  (403 without `configs.queues_status.view`); 200 returns a snapshot whose failed-job
  entries contain **no payload/`data` field**; `limit` query is clamped to the server cap;
  works with `QUEUE_STRATEGY=local` and (when Redis configured) `QUEUE_STRATEGY=async`.

**Key UI paths**
- `/backend/config/queues-status` — renders per-queue counts with DS status tokens;
  failed-jobs table shows only id/queue/worker/reason/attempts/failed-at; loading and error
  states render via `LoadingMessage`/`ErrorMessage`; refresh re-fetches counts only.
- `/backend/config/system-status` — the link/section to the queue status surface resolves.

**Strategy coverage**
- Integration/unit coverage MUST exercise both `local` and `async` strategies for the
  introspection methods (per `packages/queue/AGENTS.md` "MUST test with both strategies").

## Backward Compatibility

Contract surface touched: the `@open-mercato/queue` **types** and the **`Queue` interface**
(STABLE contract surfaces per `BACKWARD_COMPATIBILITY.md`). All changes are **additive-only**:

- `getJobCounts()` gains an **optional** `delayed?` field — existing callers that read only
  `waiting/active/completed/failed` are unaffected.
- `getFailedJobsSummary?` is an **optional** method — existing `Queue` implementations and
  callers that never reference it keep compiling and behaving identically.
- New `FailedJobSummary` / `QueueStatusSnapshot` types and the new feature id, route, page,
  and injection spot are **net-new additions**, not changes to existing ids.
- No DB schema change, no migration, no event-id change, no removed/renamed export.

No deprecation protocol is required because nothing is removed or changed in a
breaking way. The new ACL feature must be synced to roles via `setup.ts` so existing tenants
gain the grant on upgrade.

## Non-Goals

- Reading, decrypting, or displaying job payloads (`job.data`) — **explicitly forbidden**.
- Enumerating entire queues or paginating across the full job set — only aggregate counts
  plus a small bounded failed window.
- Mutating actions (retry/remove/drain) — deferred to a follow-up phase with its own write
  feature.
- Per-tenant queue filtering/attribution — would require payload inspection; out of scope.
- A real-time push/SSE feed — manual/interval refresh of cheap aggregates is sufficient.

## Validation Commands

```bash
yarn generate
yarn workspace @open-mercato/queue test
yarn workspace @open-mercato/queue build
yarn typecheck
yarn lint
yarn i18n:check-hardcoded
```
