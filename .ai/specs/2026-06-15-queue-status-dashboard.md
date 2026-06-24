# Queue Status Dashboard — Queue Health, Failed-Job Visibility & Privileged Job Inspection

- **Status:** Draft (deferred — not yet implemented)
- **Scope:** OSS
- **Owner module:** `configs` (admin surface) + `@open-mercato/queue` (introspection contract)
- **Tracking issue:** _filled in after issue creation_

## TLDR

Add a **two-tier Queue Status** admin surface:

- **Tier 1 — Status (default, payload-free, broad access).** Per registered queue, current
  job counts by state (waiting / active / completed / failed / delayed) plus a **bounded,
  payload-free** list of recent failed jobs (id, queue, worker id, error/reason, attempts,
  failed-at). Safe to open against very large queues — it never enumerates the whole queue
  and never loads or renders job payloads (`job.data`). Counts come from aggregate APIs
  (`Queue.getJobCounts()`); the failed-job list is a small bounded window with the payload
  stripped server-side. Tier 1 also surfaces, all **payload-free** and server-bounded:
  - **Per-queue processing-time metrics** — average and last processing duration (and average
    wait/latency) computed from a bounded sample of recent completed jobs, so an operator can
    see at a glance which queues are slow.
  - **In-flight visibility** — the currently-processing (active) jobs with how long each has
    been running (`now − processedOn`), and the oldest waiting/delayed jobs with how long they
    have been queued (`now − enqueuedAt`), so stuck or slow jobs are obvious.
  - **Filtering by queue and job type** — narrow the status view to a single queue (`?queue=`)
    and/or a single job type/name (`?type=`) to hunt down stuck records in a busy queue.
- **Tier 2 — Job Inspector (opt-in, privileged, audited).** A separately gated capability to
  load the **last X jobs** for a queue (optionally filtered by state) **including their
  payloads** for debugging. Because queues are infrastructure-level and shared across
  tenants, and payloads can carry PII / encrypted-at-rest data, this tier is behind its own
  higher-privilege feature (`configs.queues_status.inspect_payloads`), is **bounded**
  (server-capped `X`), **audited** (every payload read is logged), and applies
  **redaction-by-default** for encrypted/known-sensitive fields. It is explicitly NOT part
  of the broadly-accessible dashboard. Tier 1 rows (a failed job, a stuck active job, an aged
  waiting job) become **click-through** into this Inspector when — and only when — the session
  holds the inspect feature: clicking a row opens the Inspector drawer scoped to that single
  job id so the operator can read its full (tenant-filtered, redaction-applied) payload. For
  sessions without the feature the rows are not clickable and no payload path exists.

Both tiers work for `local` (file-based) and `async` (BullMQ/Redis) strategies, degrading
gracefully where the local strategy cannot supply a state.

## Open Questions

The two architecture-blocking decisions for the **Job Inspector tier** are answered inline
in this spec (gating model, redaction, audit), but the maintainer should confirm two policy
choices before implementation — they change the ACL/redaction surface, not the overall
shape:

1. **Who may inspect payloads?** Default in this spec: a dedicated platform feature
   `configs.queues_status.inspect_payloads`, granted to platform-operator/superadmin roles
   only (NOT bundled with the read-only `.view` grant). Confirm whether ordinary tenant
   admins should ever get it. Given cross-tenant exposure (see Tenant Scoping), the spec
   recommends **superadmin/platform-operator only**.
2. **Decrypt encrypted payload fields?** Default in this spec: **no** — encrypted-at-rest
   fields are shown redacted/as-ciphertext; raw decryption is out of scope for Phase 2 and
   would require an even higher, separately-audited privilege. Confirm this is acceptable.

The previously deferred decisions (mutating actions; per-tenant aggregation) remain
non-goals below.

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
   The **Tier 1 status surface** MUST NOT expose payloads — only **non-sensitive status
   metadata** (counts, ids, worker id, error message/reason, attempt count, timestamps) may
   leave the server.

Operators have also asked to **inspect actual job payloads** for the last few jobs when
debugging a stuck or misbehaving worker (e.g. "what exactly did that failed sync job
receive?"). That is a legitimate need, but it is the **opposite** of constraint 2 above, so
it cannot live on the broadly-accessible dashboard. The spec resolves this with a
**second, privileged tier** (Job Inspector) that is separately gated, bounded, audited, and
redaction-by-default — never folded into the Tier 1 grant.

## Proposed Solution

### Architecture overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│ configs module (admin surface)                                             │
│  TIER 1 — Status (payload-free, broad access)                              │
│   backend/config/queues-status/page.tsx   ──renders──▶ QueueStatusPanel    │
│   api/queues-status/route.ts  (GET, requireFeatures: queues_status.view)   │
│     ?queue=<name>  ?type=<jobName>  → optional server-side filters         │
│        │ lib/queue-status.ts  buildQueueStatusSnapshot({queue?,type?})     │
│        │ enumerate queues; per queue: getJobCounts() + getFailedJobsSummary│
│        │   + getProcessingStats() (avg/last/wait) + getInFlightJobsSummary │
│        │     (active runningMs, waiting/delayed ageMs)                      │
│        ▼ returns sanitized snapshot (NO job.data; durations/timestamps only)│
│                                                                            │
│  TIER 2 — Job Inspector (payload-visible, privileged, audited)            │
│   QueueJobInspector (drawer, opt-in) ◀── click a Tier-1 row (if feature)   │
│   api/queues-status/jobs/route.ts                                          │
│     (GET, requireFeatures: queues_status.inspect_payloads)                 │
│     ?queue=&state=&limit=  (last-X)   |   ?queue=&id=<jobId>  (single job)  │
│        │ clamp X; audit-log the access (actor, queue, state, count)        │
│        │ lib/queue-job-inspector.ts  loadRecentJobs / loadJobById          │
│        │   → tenant-filter, then redact encrypted/sensitive fields         │
│        ▼ returns last-X (or one) jobs INCLUDING (redacted) payload         │
└───────────────────────────────┼────────────────────────────────────────────┘
                                │ uses additive contract
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ @open-mercato/queue (introspection contract — ADDITIVE only)               │
│   Queue.getJobCounts()  (exists) → add optional `delayed`                  │
│   Queue.getFailedJobsSummary?(limit, offset)  (NEW, optional) — no payload │
│   Queue.getProcessingStats?(opts)  (NEW, optional) — durations only        │
│     async: sample last-N completed getJobs(['completed']) → avg/last/p95   │
│     local: partial/derived, marked fidelity:'partial'                      │
│   Queue.getInFlightJobsSummary?(opts)  (NEW, optional) — timing, no payload│
│     async: getJobs([state],0,limit-1) → active runningMs, waiting ageMs    │
│   Queue.getRecentJobs?(opts)  (NEW, optional) — INCLUDES raw payload       │
│     async: BullMQ getJobs([state], 0, X-1) / getJob(id) → full job + data  │
│     local: read last-X entries from the queue file, bounded                │
│   (getRecentJobs returns raw data; redaction is the CALLER's job in        │
│    configs/lib/queue-job-inspector.ts, not the queue package's)            │
└──────────────────────────────────────────────────────────────────────────┘
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

### Processing-time metrics (bounded sample, payload-free)

To answer "which queues are slow / how long does a job take", each queue exposes
average/last processing durations derived from a **bounded sample** of recent completed jobs.
This is timing metadata only — durations and timestamps — never `job.data`.

A new **optional** method on the `Queue` contract:

```ts
getProcessingStats?(opts?: {
  type?: string        // optional BullMQ job name/type filter
  sampleSize?: number  // server-clamped; default 50, max e.g. 200
}): Promise<QueueProcessingStats>

type QueueProcessingStats = {
  sampleSize: number        // how many completed jobs were actually sampled
  lastProcessingMs?: number // duration of the most recent completed job (finishedOn − processedOn)
  avgProcessingMs?: number  // mean processing duration over the sample
  p95ProcessingMs?: number  // optional tail latency over the sample
  avgWaitMs?: number        // mean queue latency over the sample (processedOn − timestamp)
  lastCompletedAt?: number  // epoch ms of the newest completed job in the sample
  fidelity?: 'exact' | 'partial'
}
```

- **async (BullMQ):** sample `queue.getJobs(['completed'], 0, sampleSize - 1)` (newest-first,
  bounded — **never** a full scan) and compute durations from each job's `processedOn` /
  `finishedOn` / `timestamp`. `lastProcessingMs` is the newest job's
  `finishedOn − processedOn`. Where the deployment has BullMQ metrics collection enabled,
  `queue.getMetrics('completed', …)` MAY be used instead, but the bounded-sample path is the
  default so the feature needs no metrics opt-in.
- **local:** processing timestamps are partial/derived; the method returns what it can with
  `fidelity: 'partial'` (or omits the durations entirely), and the UI labels it honestly.
- `sampleSize` is hard-capped server-side. Reads no payload — only the four timestamp fields
  per sampled job are touched.

If a strategy does not implement `getProcessingStats`, the snapshot omits the metrics block
for that queue and the UI hides it.

### In-flight & aged-waiting jobs (timing, payload-free)

To answer "show the items being processed right now and how long they're taking" and "how
long have the non-processed jobs been waiting", each queue exposes a small, payload-free
window of in-flight jobs with their timings.

A new **optional** method on the `Queue` contract:

```ts
getInFlightJobsSummary?(opts: {
  state?: 'active' | 'waiting' | 'delayed'  // default: active
  type?: string                              // optional job name/type filter
  limit: number                              // server-clamped, e.g. ≤ 50, default 20
}): Promise<InFlightJobSummary[]>

// Sanitized — intentionally OMITS job.data / payload.
type InFlightJobSummary = {
  id: string
  queue: string
  type?: string         // BullMQ job name, when present
  workerId?: string     // best-effort, when derivable
  state: 'active' | 'waiting' | 'delayed'
  enqueuedAt?: number   // epoch ms (job.timestamp)
  startedAt?: number    // epoch ms (job.processedOn) — active only
  runningMs?: number    // now − startedAt — how long an ACTIVE job has been processing
  ageMs?: number        // now − enqueuedAt — how long a WAITING/DELAYED job has been queued
  attemptsMade?: number
}
```

- **async (BullMQ):** `queue.getJobs([state], 0, limit - 1)` (bounded window), map the
  allow-listed fields. For `waiting`/`delayed` this window is the **head of the queue** (the
  oldest / next-to-run jobs — exactly the ones that look stuck); for `active` it is the
  in-progress set. `runningMs`/`ageMs` are computed **server-side** from the job timestamps and
  the request time so the client never derives them. `job.data` is never read.
- **local:** best-effort from the bounded file window; partial fidelity where timestamps are
  unavailable.
- The active view is what "currently processed items and how long it takes" renders; the
  waiting/delayed view (oldest-first, the queue head) is how an operator spots a backlog of
  stuck records. `limit` is hard-capped server-side.

If a strategy does not implement `getInFlightJobsSummary`, the snapshot omits the in-flight
block and the UI shows it as unavailable for that strategy.

### Filtering by queue & job type (finding stuck records)

The Tier 1 status API accepts two **optional** server-side filters so an operator can drill
into a busy queue rather than scanning every queue:

- `?queue=<name>` — restrict the snapshot to a single registered queue (validated against the
  worker-registry queue list; unknown names yield an empty, not erroring, snapshot).
- `?type=<jobName>` — restrict the failed / in-flight summaries (and the processing-stats
  sample, where the strategy supports it) to a single BullMQ job name/type.

Both filters are applied **server-side** and stay within the same bounded windows — they
narrow what is fetched, never widen it, and never enable enumeration. Counts remain the
aggregate `getJobCounts()` numbers (which are not type-partitioned at the strategy level); the
type filter applies to the bounded summary lists where per-job `name` is available. This is
the "filter the jobs to inspect by queue name / type so we can find stuck records" capability,
kept entirely payload-free at Tier 1.

### Job Inspector (Tier 2) — last-X jobs *with* payload (privileged, tenant-safe, audited)

This is the capability behind "load the last X jobs and check their payloads too." It is
**not** part of the Tier 1 dashboard grant. It exists so an operator can debug a specific
stuck/failed job, and it is deliberately constrained on four axes: **bounded**, **gated**,
**tenant-scoped**, and **audited**.

A new **optional** method on the `Queue` contract returns full jobs *including* raw payload —
redaction and tenant filtering are the **caller's** responsibility, never the queue
package's (the queue stays a dumb transport):

```ts
getRecentJobs?(opts: {
  state?: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
  type?: string          // optional BullMQ job name/type filter
  id?: string            // fetch a SINGLE job by id (the click-through path) — bounded to one
  limit: number          // last-X; server-clamped by the caller before this is reached
  offset?: number
}): Promise<RecentJob[]>

type RecentJob = {
  id: string
  queue: string
  state?: string
  attemptsMade?: number
  timestamp?: number
  processedOn?: number
  finishedOn?: number
  failedReason?: string
  data: unknown          // RAW payload — caller MUST tenant-filter + redact before responding
}
```

- **async (BullMQ):** `queue.getJobs([state ?? all-states], 0, limit - 1)` → newest-first
  window. **Never** a full scan. When `id` is supplied, `queue.getJob(id)` returns the single
  job (this is the click-through path: a Tier 1 row carries the job id, the drawer fetches just
  that one job).
- **local:** read the last-X entries from the queue file, bounded; resolve a single `id`
  directly when supplied.

**Click-through from Tier 1 (full inspection).** The "click a queue item and inspect its
payload fully" capability is exactly this single-job path. A Tier 1 row (failed, active, or
aged-waiting) already carries the job id and queue; clicking it opens the Inspector drawer,
which calls `GET /api/configs/queues-status/jobs?queue=<name>&id=<jobId>`. The same tenant
filter, redaction-by-default, server clamp (one job), and audit record apply — a single-job
fetch is not a privilege escalation over the last-X fetch, just a narrower window. The drawer
renders the **full** payload structure with sensitive/encrypted fields redacted; "fully" means
the complete (redacted) object tree, not raw decryption (Open Questions Q2). The row is only
clickable for sessions holding `inspect_payloads`; tenant isolation still drops a foreign job
even if its id is known (a non-superadmin requesting another tenant's job id gets an empty
result, fail-closed).

**Tenant safety (the core rule).** Queues are infrastructure-level and shared across
tenants, so a raw last-X window can contain other tenants' jobs. The inspector layer
(`configs/lib/queue-job-inspector.ts`) enforces tenant isolation **before** anything leaves
the server:

1. Resolve the actor's scope from the session: `isSuperAdmin`, `tenantId`,
   `organizationId`.
2. For each candidate job, extract its **own** tenant scope from the well-known job envelope
   fields the platform already stamps on enqueued jobs (e.g. `data.tenantId` /
   `data.organizationId`, mirroring the scoped-payload convention used elsewhere). A job
   whose tenant cannot be determined is treated as **cross-tenant / not yours** (fail
   closed), not shown to a tenant admin.
3. **Filter:**
   - **Superadmin / platform operator** (no tenant binding): may see jobs across **all**
     tenants. The response still records which tenant each job belongs to, and the access is
     audited.
   - **Any non-superadmin** (even with `inspect_payloads`): the server **drops every job
     whose `tenantId` ≠ the actor's `tenantId`** before building the response. A tenant
     admin can therefore **never** see another tenant's jobs or payloads — the filtering is
     server-side and not bypassable by query params. `X` is applied **after** the tenant
     filter so the count can't be used to probe how many foreign jobs exist.
4. **Redact-by-default:** known-sensitive / encrypted-at-rest payload fields are redacted
   (shown as `«redacted»` / ciphertext marker) regardless of tier. Raw decryption is a
   non-goal (see Open Questions Q2).

**Gating.** A second, higher-privilege feature `configs.queues_status.inspect_payloads`,
granted to platform-operator/superadmin roles only and NOT bundled with the read-only
`.view` grant (Open Questions Q1). The cross-tenant *breadth* is gated by superadmin status
on top of the feature — i.e. the feature lets you inspect payloads, being superadmin lets
you inspect *beyond your own tenant*.

**Bounding & audit.** `X` is server-clamped (e.g. ≤ 100, default 20). Every inspector call
writes an **audit record** (actor id, tenant, queue, requested state, returned count,
whether cross-tenant breadth was used) so payload access is traceable. The Tier 1 dashboard
never triggers this path.

If a strategy does not implement `getRecentJobs`, the Job Inspector is disabled for that
queue and the UI shows "payload inspection unavailable for this strategy".

### Admin surface

- New backend page `configs/backend/config/queues-status/page.tsx` rendering a
  `QueueStatusPanel` component, mirroring the existing `SystemStatusPanel` pattern and using
  `Page`/`PageBody` from `@open-mercato/ui/backend/Page`.
- The panel reads from the new API route via `apiCall` (never raw `fetch`), shows a per-queue
  card/table with the state counts using **Design System status tokens** (e.g. failed uses
  `text-status-danger-*` / `bg-status-danger-*`, never hardcoded `text-red-*`), and a
  collapsible bounded failed-jobs table.
- Each queue card also shows the **processing-time metrics** (avg / last / p95 / avg-wait,
  formatted as human durations; partial-fidelity queues are labelled) and an **in-flight
  table**: active jobs with a live "running for Xs" duration, plus the oldest waiting/delayed
  jobs with an "queued for Xs" age so backlogs and stuck records are visible at a glance.
  Durations render with neutral DS tokens; jobs exceeding a soft threshold may be emphasised
  with `text-status-warning-*` (never hardcoded amber).
- A **filter bar** lets the operator pick a queue and/or type a job type/name; selecting them
  sets `?queue=` / `?type=` on the next `apiCall` so the bounded summaries narrow server-side.
- Tier 1 rows (failed / in-flight) are **clickable only when the session holds
  `inspect_payloads`** — clicking opens the Job Inspector drawer for that single job id
  (the click-through path above). Without the feature the rows are plain, non-interactive.
- Add a link/section from the existing System Status page (or a sibling nav entry under
  `config`) and an `InjectionSpot` (e.g. `configs.queues_status:details`) for extension.
- All strings via `useT()` / `resolveTranslations()`; no hardcoded user-facing copy.
- Manual auto-refresh only (button or a modest interval). Because every refresh is just
  aggregate counts + a tiny bounded window, polling stays cheap even on huge queues.
- **Job Inspector drawer (Tier 2)** is rendered **only** when the session carries
  `configs.queues_status.inspect_payloads`; otherwise the affordance is absent (not just
  disabled). Opening it shows a clear notice that payloads may contain sensitive data and
  that access is audited. For non-superadmins it states "showing only your tenant's jobs";
  for superadmins it shows a per-row tenant badge. The payload renders as collapsed,
  redaction-applied JSON.

### Access control

Two immutable feature ids in `configs/acl.ts`:

- `configs.queues_status.view` (Tier 1, read) — guards `GET /api/configs/queues-status`,
  mirroring how `system-status` guards `configs.system_status.view`. Safe to grant broadly
  to admins; exposes no payloads.
- `configs.queues_status.inspect_payloads` (Tier 2, privileged read) — guards
  `GET /api/configs/queues-status/jobs`. **Not** bundled into the `.view` grant; synced only
  to platform-operator/superadmin roles in `setup.ts`. Holding this feature lets you inspect
  payloads **for your own tenant**; seeing **other tenants'** jobs additionally requires
  superadmin status (enforced server-side in the inspector layer, see Tenant scoping).

No mutating endpoint in this spec, so no `configs.manage`-style write feature is added yet
(retry/remove is a deferred non-goal).

### Tenant scoping

Queues are **infrastructure-level**, not tenant-partitioned — one BullMQ/local queue is
shared across tenants; each job carries its own tenant scope inside its envelope.

- **Tier 1 (Status):** surfaces **aggregate counts** and **payload-free** failed metadata
  only, so it cannot leak cross-tenant content regardless of who views it. (Counts are
  process-wide infrastructure health, intentionally not per-tenant.)
- **Tier 2 (Job Inspector):** because it reads payloads, it enforces strict tenant
  isolation **server-side**, and this is the hard rule the feature must satisfy:

  > **A non-superadmin MUST NOT be able to see jobs (or payloads) belonging to any tenant
  > other than their own. Only a superadmin / platform operator may inspect jobs across
  > tenants.**

  The inspector resolves the actor's tenant from the session, extracts each job's tenant
  from its envelope, and — for any non-superadmin — drops every job whose tenant ≠ the
  actor's tenant **before** the response is built (the `X` limit is applied after this
  filter, and the filter is not overridable by query params). Jobs whose tenant cannot be
  determined are treated as not-yours and withheld from non-superadmins (fail closed).
  Superadmins bypass the tenant filter but every access is audited with the tenant of each
  returned job. This is enforced in `configs/lib/queue-job-inspector.ts` and covered by the
  integration tests below (a tenant-A admin requesting jobs sees zero tenant-B jobs even
  when tenant-B jobs are the most recent in the shared queue).

## Risks & Impact Review

Each risk lists the concrete failure scenario, severity, affected area, mitigation, and
residual risk after mitigation.

| # | Failure scenario | Severity | Affected area | Mitigation | Residual risk |
|---|------------------|----------|---------------|------------|---------------|
| R1 | **Cross-tenant payload/PII leak.** A non-superadmin with `inspect_payloads` retrieves jobs belonging to another tenant from the shared queue (the headline risk — payloads carry PII / encrypted-at-rest content). | Critical | Tier 2 Job Inspector (`configs/lib/queue-job-inspector.ts`, `GET /api/configs/queues-status/jobs`) | Server-side tenant filter drops every job whose `tenantId` ≠ actor's before the response is built; filter not overridable by query params; `X` applied **after** the filter; unknown-tenant jobs fail closed (withheld). Cross-tenant breadth additionally gated by superadmin status, not just the feature. Covered by the critical integration test (tenant-A sees zero tenant-B rows). | Low — depends on the job envelope correctly stamping `tenantId`. A job enqueued without a tenant stamp is treated as foreign (fail closed), so the residual is "a legitimately own-tenant job is hidden", never "a foreign job is shown". |
| R2 | **Sensitive field exposed despite redaction.** A payload field that is sensitive but not on the known-sensitive/encrypted list renders in cleartext in the inspector. | High | Tier 2 inspector redaction | Redact-by-default for known-sensitive/encrypted keys; encrypted-at-rest fields shown as ciphertext marker; raw decryption is a non-goal. Audit record makes any access traceable. | Medium — redaction is allow-list/heuristic-based; an unrecognized sensitive key could surface. Mitigated operationally by the audit trail and by restricting the feature to superadmin/platform-operator roles. Tightening the redaction list is a follow-up. |
| R3 | **Scale / DoS on a huge queue.** A view enumerates hundreds of thousands of jobs, hammering Redis or reading a massive local file, OOMing the request. | High | Tier 1 counts + failed window + **processing-stats sample** + **in-flight window**, Tier 2 last-X / single-id window | Counts come from aggregate `getJobCounts()` (O(1)-ish); failed list, processing-stats sample, in-flight window, and inspector are all hard-capped bounded windows (`limit`/`sampleSize` server-clamped, never a full scan); the single-`id` inspector path touches exactly one job; no full-queue enumeration anywhere. | Low — bounded windows cap worst-case work regardless of queue size. |
| R4 | **Privilege creep via grant bundling.** `inspect_payloads` accidentally bundled into the broadly-granted `.view` feature, giving ordinary admins payload access. | High | ACL (`configs/acl.ts`, `setup.ts`) | The two features are distinct immutable ids; `.inspect_payloads` is synced to platform-operator/superadmin roles only and explicitly NOT bundled with `.view`. Open Question Q1 flags this for maintainer confirmation. | Low if the setup sync is implemented as specified; an ACL test should assert `.inspect_payloads` is absent from ordinary-admin roles. |
| R5 | **Audit gap.** A payload read is not recorded, so cross-tenant / superadmin access is untraceable. | Medium | Tier 2 audit record | Every inspector call writes an audit record (actor, tenant, queue, state, returned count, cross-tenant-breadth flag) before returning; integration test asserts a record is written per call. | Low — audit sits on the single server-side code path the route delegates to. |
| R6 | **Misleading local-strategy counts.** The `local` strategy reports partial/derived counts that an operator reads as exact live numbers and makes a wrong call. | Low | Tier 1 counts (local strategy) | Snapshot marks local queues `fidelity: 'partial'`; the UI labels them honestly rather than implying exact live counts. | Low — operational/cosmetic, not a data-safety risk. |
| R7 | **Backward-compatibility regression.** Adding introspection methods breaks existing `Queue` implementations or callers. | Low | `@open-mercato/queue` contract | All additions are optional (`delayed?`, `getFailedJobsSummary?`, `getProcessingStats?`, `getInFlightJobsSummary?`, `getRecentJobs?`); existing callers and implementations are unaffected (see Backward Compatibility). | Negligible — additive-only; verified by the existing queue contract tests plus new shape tests. |
| R8 | **Misleading processing metrics / in-flight timings.** A small completed-job sample skews avg/p95, or a clock skew between enqueue and the request makes `runningMs`/`ageMs` look wrong, so an operator misjudges queue health. | Low | Tier 1 processing-stats + in-flight (both strategies) | Metrics report the actual `sampleSize` so the operator knows the basis; durations are computed server-side from the job's own `timestamp`/`processedOn`/`finishedOn` and the request time (single clock); local-strategy partial timings are marked `fidelity:'partial'` and labelled honestly in the UI. | Low — informational/operational, not a data-safety risk; tightening with real BullMQ metrics is a follow-up. |

**Overall impact:** a net-new admin surface with no DB schema change to the queue/status
surface itself and no migration (an optional persisted audit table, if chosen, is itself
additive). The dominant risk is R1 (cross-tenant payload leak); the design treats
server-side tenant isolation with fail-closed semantics as the hard, test-gated invariant.

## Phasing (stories)

### Phase 1 — Introspection contract (queue package)
Additive, payload-free introspection on the `Queue` contract for both strategies: counts
(`delayed?`), `getFailedJobsSummary?`, **`getProcessingStats?`** (avg/last/p95/wait durations
from a bounded completed-job sample), and **`getInFlightJobsSummary?`** (active `runningMs`,
waiting/delayed `ageMs`). All payload-free, all bounded.

### Phase 2 — Status API + snapshot builder (configs module)
`buildQueueStatusSnapshot({ queue?, type? })` + guarded `GET /api/configs/queues-status`
returning the sanitized snapshot. Phase 2 includes the operator-facing Tier 1 capabilities
requested for this surface:
- **Per-queue processing-time metrics** (average + last + p95 + average wait) folded into the
  snapshot from `getProcessingStats?`.
- **In-flight visibility** — currently-processing (active) jobs with `runningMs`, and the
  oldest waiting/delayed jobs with `ageMs`, from `getInFlightJobsSummary?`.
- **Filtering** by `?queue=<name>` and/or `?type=<jobName>`, applied server-side to the
  bounded summaries so stuck records can be isolated in a busy queue.

All of Phase 2 stays **payload-free**; reading an actual payload is the Tier 2 click-through
(Phase 4) and is feature-gated.

### Phase 3 — Admin UI (Tier 1)
`QueueStatusPanel` + page + nav/injection + i18n + DS-token styling, including the
processing-time metrics block, the in-flight/aged-waiting table, the queue/type filter bar,
and rows that become click-through to the Inspector only when `inspect_payloads` is held.

### Phase 4 — Job Inspector (Tier 2, privileged + tenant-safe + audited)
`getRecentJobs` contract method (last-X **and** single-job-by-`id`), the tenant-isolating +
redacting inspector lib, the `inspect_payloads`-gated `GET /api/configs/queues-status/jobs`
route, the audit record, and the inspector drawer UI. This is the "load last X jobs and check
payloads" capability **and** the "click a Tier 1 row to inspect that one job's payload fully"
click-through.

### Phase 5 (non-goal / follow-up) — Mutating actions
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
3. **Queue contract — processing stats.** Add optional `getProcessingStats?(opts?)` +
   `QueueProcessingStats` type (durations/timestamps only, no `data`) to the `Queue`
   interface. Implement in `async.ts` (bounded `getJobs(['completed'],0,sampleSize-1)` →
   compute avg/last/p95 from `processedOn`/`finishedOn` and `avgWaitMs` from
   `processedOn − timestamp`; honor optional `type` filter on `job.name`) and `local.ts`
   (partial/derived, `fidelity:'partial'`). _Test:_ unit test that durations are computed
   from a bounded sample (no full scan), `sampleSize` is clamped, the result contains **no
   payload key**, and an empty queue yields a defined-but-empty stats object.
4. **Queue contract — in-flight summary.** Add optional `getInFlightJobsSummary?(opts)` +
   `InFlightJobSummary` type (no `data`) to the `Queue` interface. Implement in `async.ts`
   (`getJobs([state],0,limit-1)`, compute `runningMs` for active and `ageMs` for
   waiting/delayed **server-side**, honor `type` filter) and `local.ts` (best-effort/partial).
   _Test:_ unit test that active jobs carry `runningMs`, waiting/delayed carry `ageMs`, the
   `limit` is capped, objects contain **no payload key**, and `state`/`type` filters narrow
   the window.
5. **Snapshot builder.** `configs/lib/queue-status.ts` → `buildQueueStatusSnapshot({ queue?,
   type? })`: enumerate queues from the worker registry (filter to `queue` when supplied),
   resolve `createQueue` via DI per strategy, call counts + failed-summary +
   processing-stats + in-flight-summary (passing the optional `type` through), assemble
   `QueueStatusSnapshot` with a `fidelity` flag per queue. zod schema for the snapshot in
   `configs/lib/queue-status.types.ts` (derive TS via `z.infer`). _Test:_ unit test
   enumeration/dedup, the `queue`/`type` narrowing, and sanitization (asserts no `data`
   anywhere in the snapshot, including metrics and in-flight blocks).
6. **API route.** `configs/api/queues-status/route.ts` `GET` guarded by
   `requireFeatures: ['configs.queues_status.view']`; parse + validate optional `queue` /
   `type` query params (zod); clamp every `limit`/`sampleSize` server-side; return the
   snapshot; map errors to a translated 500 (mirror `system-status/route.ts`). Add OpenAPI
   doc entries documenting `queue`/`type`. _Test:_ integration test on
   `/api/configs/queues-status` (auth required, feature gate, payload-free body including
   metrics + in-flight, `queue`/`type` filter narrows results, `limit`/`sampleSize` clamp).
7. **ACL.** Add `configs.queues_status.view` to `configs/acl.ts`; sync to the relevant role
   features in `setup.ts`. Run `yarn generate`.
8. **UI panel.** `QueueStatusPanel` (DS status tokens, no hardcoded colors), `apiCall`,
   `LoadingMessage`/`ErrorMessage`, i18n keys, bounded failed-jobs table with **no payload
   column**, the **processing-time metrics** block (avg/last/p95/wait as formatted
   durations), the **in-flight table** (active `runningMs`, waiting/delayed `ageMs`), and a
   **queue/type filter bar** wiring `?queue=`/`?type=` into `apiCall`. _Test:_ component test
   asserts the failed + in-flight tables render only allow-listed fields and that the filter
   bar drives the request params.
9. **Page + nav + injection.** `backend/config/queues-status/page.tsx`, nav/menu entry under
   `config`, `InjectionSpot` `configs.queues_status:details`, link from System Status.
10. **Queue contract — recent jobs (Tier 2).** Add optional `getRecentJobs?(opts)` +
    `RecentJob` type (includes raw `data`) to the `Queue` interface, supporting last-X **and**
    single-job-by-`id` (and an optional `type` filter). Implement in `async.ts`
    (`getJobs([state], 0, limit-1)`, or `getJob(id)` when `id` is set) and `local.ts` (last-X
    bounded file read, or direct id lookup). _Test:_ unit test newest-first ordering, `limit`
    cap, and single-`id` resolution per strategy.
11. **Inspector lib (tenant-safe + redaction).** `configs/lib/queue-job-inspector.ts`:
    resolve actor scope (`isSuperAdmin`, `tenantId`), extract each job's tenant from the
    envelope, **drop foreign-tenant jobs for non-superadmins (apply `X` after the filter,
    fail closed on unknown tenant)** — this applies equally to a single-`id` lookup, redact
    encrypted/sensitive fields. zod schema for the response. _Test (critical):_ unit test that
    a tenant-A actor receives **zero** tenant-B jobs from a mixed queue (including by direct
    `id`), that the limit is applied post-filter, and that redaction hides sensitive keys;
    superadmin sees both tenants with per-job tenant tag.
12. **Inspector ACL + audit.** Add `configs.queues_status.inspect_payloads` to `acl.ts`;
    sync to platform-operator/superadmin roles only in `setup.ts`. Write an audit record on
    each inspector call. Run `yarn generate`.
13. **Inspector API route.** `configs/api/queues-status/jobs/route.ts` `GET` guarded by
    `requireFeatures: ['configs.queues_status.inspect_payloads']`; supports both the last-X
    list (`state`/`type`/`limit`) and the single-job click-through (`id`); clamp `X`
    server-side; delegate to the inspector lib (tenant filter applies even to a known `id`);
    OpenAPI doc. _Test (integration):_ 401 unauth; 403 without the feature; tenant-A admin
    sees only tenant-A jobs; superadmin sees cross-tenant; `X` clamp; **a non-superadmin
    requesting another tenant's job by `id` gets an empty result (fail-closed)**; no
    un-redacted sensitive field in the body; an audit record is written per call.
14. **Inspector UI + click-through.** `QueueJobInspector` drawer rendered only when the
    feature is present; sensitive-data + audit notice; per-row tenant badge for superadmin;
    collapsed redacted JSON payload; `apiCall`, DS tokens, i18n. Wire Tier 1 failed/in-flight
    rows to open the drawer for a single `id` when the feature is held (rows non-interactive
    otherwise). _Test:_ component test asserts the drawer is absent without the feature, that
    rows are non-clickable without it, and that clicking a row with the feature loads and
    renders that job's redacted payload.
15. **i18n + checks.** Add locale keys; run `yarn i18n:check-hardcoded`. Prefix any internal
    `throw`/`toast` with `[internal]`.

## Integration Coverage

**Affected API paths**
- `GET /api/configs/queues-status` (Tier 1) — auth required (401 without session); feature
  gate (403 without `configs.queues_status.view`); 200 returns a snapshot whose failed-job
  **and** in-flight entries contain **no payload/`data` field** (only ids, types, timestamps,
  and server-computed durations); the **processing-stats** block carries durations only;
  `limit`/`sampleSize` queries are clamped to the server cap; the optional `?queue=<name>`
  filter narrows the snapshot to one queue and `?type=<jobName>` narrows the failed/in-flight
  summaries (assert that a known type returns only matching jobs and an unknown queue returns
  an empty, non-erroring snapshot); active jobs report `runningMs`, waiting/delayed report
  `ageMs`; works with `QUEUE_STRATEGY=local` and (when Redis configured) `QUEUE_STRATEGY=async`.
- `GET /api/configs/queues-status/jobs` (Tier 2, Job Inspector) — auth required (401); feature
  gate (403 without `configs.queues_status.inspect_payloads`); **tenant isolation (the
  critical case): a tenant-A admin requesting the last-X jobs of a queue that contains
  tenant-B jobs receives ONLY tenant-A jobs — zero tenant-B rows — even when tenant-B jobs
  are the most recent**; a **superadmin** receives cross-tenant jobs each tagged with its
  tenant; `X` is clamped server-side and applied **after** the tenant filter; the
  single-job click-through (`?id=<jobId>`) returns exactly that job for an own-tenant id and
  an **empty result for a foreign-tenant id requested by a non-superadmin** (fail-closed); the
  response contains **no un-redacted sensitive/encrypted field**; every call writes an audit
  record.

**Key UI paths**
- `/backend/config/queues-status` — renders per-queue counts with DS status tokens;
  failed-jobs table shows only id/queue/worker/reason/attempts/failed-at; the processing-time
  metrics block shows avg/last/p95/wait durations; the in-flight table shows active jobs with
  `runningMs` and waiting/delayed with `ageMs`; the queue/type filter bar narrows the view;
  loading and error states render via `LoadingMessage`/`ErrorMessage`. The Job Inspector
  drawer is **absent** and Tier 1 rows are **non-clickable** for a session lacking
  `inspect_payloads`.
- `/backend/config/queues-status` (Job Inspector drawer, with `inspect_payloads`) — loads the
  last X jobs for a queue; non-superadmin sees only own-tenant jobs; superadmin sees a tenant
  badge per row; payload renders redacted; sensitive-data/audit notice shown. **Clicking a
  Tier 1 failed/in-flight row** opens the drawer scoped to that single job id and renders its
  full redacted payload.
- `/backend/config/system-status` — the link/section to the queue status surface resolves.

**Strategy coverage**
- Integration/unit coverage MUST exercise both `local` and `async` strategies for the
  introspection methods (per `packages/queue/AGENTS.md` "MUST test with both strategies").

## Backward Compatibility

Contract surface touched: the `@open-mercato/queue` **types** and the **`Queue` interface**
(STABLE contract surfaces per `BACKWARD_COMPATIBILITY.md`). All changes are **additive-only**:

- `getJobCounts()` gains an **optional** `delayed?` field — existing callers that read only
  `waiting/active/completed/failed` are unaffected.
- `getFailedJobsSummary?`, `getProcessingStats?`, `getInFlightJobsSummary?`, and
  `getRecentJobs?` are all **optional** methods — existing `Queue` implementations and callers
  that never reference them keep compiling and behaving identically. A strategy that omits any
  of them simply has that block absent from the snapshot.
- New `FailedJobSummary` / `QueueProcessingStats` / `InFlightJobSummary` / `RecentJob` /
  `QueueStatusSnapshot` types and the two new feature ids, the two routes (incl. the
  `?queue=`/`?type=`/`?id=` query params, which are additive and optional), the page, drawer,
  and injection spot are **net-new additions**, not changes to existing ids.
- No DB schema change and no migration for the queue/status surface itself. If the audit
  record is persisted to a new table, that table + migration follow the standard module
  migration workflow and are themselves additive (new entity, no change to existing schema).
- No event-id change, no removed/renamed export.

No deprecation protocol is required because nothing is removed or changed in a
breaking way. Both new ACL features must be synced to roles via `setup.ts` so existing
tenants gain the appropriate grants on upgrade — `.view` broadly,
`.inspect_payloads` to platform-operator/superadmin only.

## Non-Goals

- **Tier 1 status surface** reading/displaying payloads — forbidden; counts + payload-free
  metadata only.
- **Tier 2 Job Inspector** decrypting encrypted-at-rest payload fields — redaction-by-default
  only; raw decryption needs a separate, even-higher privilege (deferred; Open Questions Q2).
- **Cross-tenant payload access for non-superadmins** — forbidden by design; only a
  superadmin / platform operator may inspect jobs beyond their own tenant.
- Enumerating entire queues or paginating across the full job set — only aggregate counts,
  a small bounded failed window, a bounded processing-stats sample, a bounded in-flight
  window, and a small bounded last-X / single-id inspector window.
- **Full historical processing metrics / time-series charts** — processing stats are a
  bounded recent-sample average (avg/last/p95/wait), not a retained metrics history. A
  persisted metrics time-series (or wiring BullMQ's `getMetrics` collection) is a follow-up.
- Mutating actions (retry/remove/drain) — deferred to a follow-up phase with its own write
  feature.
- Per-tenant **aggregate count** attribution on Tier 1 — counts stay process-wide
  infrastructure health (per-tenant counting would require payload inspection).
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

## Final Compliance Report

This spec is **Draft (deferred — not yet implemented)**. The compliance gate below is the
checklist the implementing PR(s) must satisfy before this spec moves to
`.ai/specs/implemented/`; it is recorded now so the implementer inherits the bar rather than
re-deriving it.

| Gate | Status | Notes |
|------|--------|-------|
| Architecture: admin surface in `configs`, contract in `@open-mercato/queue`; no direct ORM cross-module relationship | ☐ deferred | Verified at design time against the existing `system-status` pattern and the worker registry export. |
| Tenant isolation: non-superadmin never sees another tenant's jobs/payloads (server-side, fail-closed) | ☐ deferred | Hard invariant; gated by the critical integration test (tenant-A → zero tenant-B rows). |
| Backward compatibility: all `@open-mercato/queue` changes additive-only | ☐ deferred | `delayed?`, `getFailedJobsSummary?`, `getProcessingStats?`, `getInFlightJobsSummary?`, `getRecentJobs?` optional; `?queue=`/`?type=`/`?id=` query params additive; no removed/renamed export, no event-id change. |
| Tier 1 stays payload-free incl. metrics + in-flight + filters | ☐ deferred | Processing stats expose durations only; in-flight summary omits `data`; `?type=` filters on `job.name`, never payload contents. Snapshot sanitization test asserts no `data` anywhere. |
| ACL: `.view` broad, `.inspect_payloads` superadmin/platform-operator only, not bundled | ☐ deferred | Immutable feature ids in `configs/acl.ts`; synced via `setup.ts`. |
| UI: DS status tokens, `apiCall`, `LoadingMessage`/`ErrorMessage`, i18n via `useT()`/`resolveTranslations()` | ☐ deferred | No hardcoded status colors or user-facing strings. |
| Integration coverage: both API paths + key UI paths + both `local`/`async` strategies | ☐ deferred | Enumerated in the Integration Coverage section. |
| `yarn generate` / `typecheck` / `lint` / `i18n:check-hardcoded` green | ☐ deferred | See Validation Commands. |

No code lands in this PR, so there is nothing to compliance-gate at merge beyond the spec
content checklist (TLDR, Problem Statement, Proposed Solution, Architecture, Data Models /
contracts, Risks & Impact Review, this report, Changelog), which this revision now satisfies.

## Changelog

- **2026-06-15** — Spec authored (Draft, deferred). Two-tier design: Tier 1 payload-free
  Queue Status (counts + bounded failed window) and Tier 2 privileged, tenant-safe, audited
  Job Inspector (last-X jobs with redacted payloads). Additive `@open-mercato/queue`
  introspection contract; no DB schema change. Tracking issue to be linked after creation.
- **2026-06-15** — Added the privileged Job Inspector tier (cross-tenant fail-closed filter,
  redaction-by-default, audit record) and the structured Risks & Impact Review + Final
  Compliance Report sections to meet the spec content checklist.
- **2026-06-17** — Extended Phase 2 (Tier 1, payload-free) with: per-queue **processing-time
  metrics** (avg/last/p95/wait from a bounded completed-job sample, `getProcessingStats?`),
  **in-flight visibility** (active `runningMs` + waiting/delayed `ageMs`,
  `getInFlightJobsSummary?`), and **queue/job-type filtering** (`?queue=`/`?type=`) to isolate
  stuck records. Added the **click-through** path so a Tier 1 row opens the Tier 2 Inspector
  for a single job id (`getRecentJobs?({ id })`, `?id=` on the inspector route), keeping the
  full-payload read tenant-filtered, redaction-by-default, and audited. Added risk R8
  (misleading metrics/timings); all new queue-contract methods remain optional/additive.
