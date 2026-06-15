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
  stripped server-side.
- **Tier 2 — Job Inspector (opt-in, privileged, audited).** A separately gated capability to
  load the **last X jobs** for a queue (optionally filtered by state) **including their
  payloads** for debugging. Because queues are infrastructure-level and shared across
  tenants, and payloads can carry PII / encrypted-at-rest data, this tier is behind its own
  higher-privilege feature (`configs.queues_status.inspect_payloads`), is **bounded**
  (server-capped `X`), **audited** (every payload read is logged), and applies
  **redaction-by-default** for encrypted/known-sensitive fields. It is explicitly NOT part
  of the broadly-accessible dashboard.

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
│        │ lib/queue-status.ts  buildQueueStatusSnapshot()                   │
│        │ enumerate queues; per queue: getJobCounts() + getFailedJobsSummary│
│        ▼ returns sanitized snapshot (NO job.data)                          │
│                                                                            │
│  TIER 2 — Job Inspector (payload-visible, privileged, audited)            │
│   QueueJobInspector (drawer, opt-in)                                        │
│   api/queues-status/jobs/route.ts                                          │
│     (GET, requireFeatures: queues_status.inspect_payloads)                 │
│        │ clamp X; audit-log the access (actor, queue, state, count)        │
│        │ lib/queue-job-inspector.ts  loadRecentJobs(queue, state, X)       │
│        │   → redact encrypted/sensitive fields by default                  │
│        ▼ returns last-X jobs INCLUDING (redacted) payload                  │
└───────────────────────────────┼────────────────────────────────────────────┘
                                │ uses additive contract
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ @open-mercato/queue (introspection contract — ADDITIVE only)               │
│   Queue.getJobCounts()  (exists) → add optional `delayed`                  │
│   Queue.getFailedJobsSummary?(limit, offset)  (NEW, optional) — no payload │
│   Queue.getRecentJobs?(opts)  (NEW, optional) — INCLUDES raw payload       │
│     async: BullMQ getJobs([state], 0, X-1) → full job incl. data           │
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
  window. **Never** a full scan.
- **local:** read the last-X entries from the queue file, bounded.

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
| R3 | **Scale / DoS on a huge queue.** A view enumerates hundreds of thousands of jobs, hammering Redis or reading a massive local file, OOMing the request. | High | Tier 1 counts + failed window, Tier 2 last-X window | Counts come from aggregate `getJobCounts()` (O(1)-ish); failed list and inspector are hard-capped bounded windows (`limit` server-clamped, never a full scan); no full-queue enumeration anywhere. | Low — bounded windows cap worst-case work regardless of queue size. |
| R4 | **Privilege creep via grant bundling.** `inspect_payloads` accidentally bundled into the broadly-granted `.view` feature, giving ordinary admins payload access. | High | ACL (`configs/acl.ts`, `setup.ts`) | The two features are distinct immutable ids; `.inspect_payloads` is synced to platform-operator/superadmin roles only and explicitly NOT bundled with `.view`. Open Question Q1 flags this for maintainer confirmation. | Low if the setup sync is implemented as specified; an ACL test should assert `.inspect_payloads` is absent from ordinary-admin roles. |
| R5 | **Audit gap.** A payload read is not recorded, so cross-tenant / superadmin access is untraceable. | Medium | Tier 2 audit record | Every inspector call writes an audit record (actor, tenant, queue, state, returned count, cross-tenant-breadth flag) before returning; integration test asserts a record is written per call. | Low — audit sits on the single server-side code path the route delegates to. |
| R6 | **Misleading local-strategy counts.** The `local` strategy reports partial/derived counts that an operator reads as exact live numbers and makes a wrong call. | Low | Tier 1 counts (local strategy) | Snapshot marks local queues `fidelity: 'partial'`; the UI labels them honestly rather than implying exact live counts. | Low — operational/cosmetic, not a data-safety risk. |
| R7 | **Backward-compatibility regression.** Adding introspection methods breaks existing `Queue` implementations or callers. | Low | `@open-mercato/queue` contract | All additions are optional (`delayed?`, `getFailedJobsSummary?`, `getRecentJobs?`); existing callers and implementations are unaffected (see Backward Compatibility). | Negligible — additive-only; verified by the existing queue contract tests plus new shape tests. |

**Overall impact:** a net-new admin surface with no DB schema change to the queue/status
surface itself and no migration (an optional persisted audit table, if chosen, is itself
additive). The dominant risk is R1 (cross-tenant payload leak); the design treats
server-side tenant isolation with fail-closed semantics as the hard, test-gated invariant.

## Phasing (stories)

### Phase 1 — Introspection contract (queue package)
Additive, payload-free introspection on the `Queue` contract for both strategies.

### Phase 2 — Status API + snapshot builder (configs module)
`buildQueueStatusSnapshot()` + guarded `GET /api/configs/queues-status` returning the
sanitized snapshot.

### Phase 3 — Admin UI (Tier 1)
`QueueStatusPanel` + page + nav/injection + i18n + DS-token styling.

### Phase 4 — Job Inspector (Tier 2, privileged + tenant-safe + audited)
`getRecentJobs` contract method, the tenant-isolating + redacting inspector lib, the
`inspect_payloads`-gated `GET /api/configs/queues-status/jobs` route, the audit record, and
the inspector drawer UI. This is the "load last X jobs and check payloads" capability.

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
8. **Queue contract — recent jobs (Tier 2).** Add optional `getRecentJobs?(opts)` + `RecentJob`
   type (includes raw `data`) to the `Queue` interface. Implement in `async.ts`
   (`getJobs([state], 0, limit-1)`) and `local.ts` (last-X bounded file read). _Test:_ unit
   test newest-first ordering + `limit` cap per strategy.
9. **Inspector lib (tenant-safe + redaction).** `configs/lib/queue-job-inspector.ts`:
   resolve actor scope (`isSuperAdmin`, `tenantId`), extract each job's tenant from the
   envelope, **drop foreign-tenant jobs for non-superadmins (apply `X` after the filter,
   fail closed on unknown tenant)**, redact encrypted/sensitive fields. zod schema for the
   response. _Test (critical):_ unit test that a tenant-A actor receives **zero** tenant-B
   jobs from a mixed queue, that the limit is applied post-filter, and that redaction hides
   sensitive keys; superadmin sees both tenants with per-job tenant tag.
10. **Inspector ACL + audit.** Add `configs.queues_status.inspect_payloads` to `acl.ts`;
    sync to platform-operator/superadmin roles only in `setup.ts`. Write an audit record on
    each inspector call. Run `yarn generate`.
11. **Inspector API route.** `configs/api/queues-status/jobs/route.ts` `GET` guarded by
    `requireFeatures: ['configs.queues_status.inspect_payloads']`; clamp `X` server-side;
    delegate to the inspector lib; OpenAPI doc. _Test (integration):_ 401 unauth; 403 without
    the feature; tenant-A admin sees only tenant-A jobs; superadmin sees cross-tenant; `X`
    clamp; no un-redacted sensitive field in the body.
12. **Inspector UI.** `QueueJobInspector` drawer rendered only when the feature is present;
    sensitive-data + audit notice; per-row tenant badge for superadmin; collapsed redacted
    JSON payload; `apiCall`, DS tokens, i18n. _Test:_ component test asserts the drawer is
    absent without the feature and renders redacted payload with it.
13. **i18n + checks.** Add locale keys; run `yarn i18n:check-hardcoded`. Prefix any internal
    `throw`/`toast` with `[internal]`.

## Integration Coverage

**Affected API paths**
- `GET /api/configs/queues-status` (Tier 1) — auth required (401 without session); feature
  gate (403 without `configs.queues_status.view`); 200 returns a snapshot whose failed-job
  entries contain **no payload/`data` field**; `limit` query is clamped to the server cap;
  works with `QUEUE_STRATEGY=local` and (when Redis configured) `QUEUE_STRATEGY=async`.
- `GET /api/configs/queues-status/jobs` (Tier 2, Job Inspector) — auth required (401); feature
  gate (403 without `configs.queues_status.inspect_payloads`); **tenant isolation (the
  critical case): a tenant-A admin requesting the last-X jobs of a queue that contains
  tenant-B jobs receives ONLY tenant-A jobs — zero tenant-B rows — even when tenant-B jobs
  are the most recent**; a **superadmin** receives cross-tenant jobs each tagged with its
  tenant; `X` is clamped server-side and applied **after** the tenant filter; the response
  contains **no un-redacted sensitive/encrypted field**; every call writes an audit record.

**Key UI paths**
- `/backend/config/queues-status` — renders per-queue counts with DS status tokens;
  failed-jobs table shows only id/queue/worker/reason/attempts/failed-at; loading and error
  states render via `LoadingMessage`/`ErrorMessage`; refresh re-fetches counts only. The Job
  Inspector drawer is **absent** for a session lacking `inspect_payloads`.
- `/backend/config/queues-status` (Job Inspector drawer, with `inspect_payloads`) — loads the
  last X jobs for a queue; non-superadmin sees only own-tenant jobs; superadmin sees a tenant
  badge per row; payload renders redacted; sensitive-data/audit notice shown.
- `/backend/config/system-status` — the link/section to the queue status surface resolves.

**Strategy coverage**
- Integration/unit coverage MUST exercise both `local` and `async` strategies for the
  introspection methods (per `packages/queue/AGENTS.md` "MUST test with both strategies").

## Backward Compatibility

Contract surface touched: the `@open-mercato/queue` **types** and the **`Queue` interface**
(STABLE contract surfaces per `BACKWARD_COMPATIBILITY.md`). All changes are **additive-only**:

- `getJobCounts()` gains an **optional** `delayed?` field — existing callers that read only
  `waiting/active/completed/failed` are unaffected.
- `getFailedJobsSummary?` and `getRecentJobs?` are **optional** methods — existing `Queue`
  implementations and callers that never reference them keep compiling and behaving
  identically.
- New `FailedJobSummary` / `RecentJob` / `QueueStatusSnapshot` types and the two new feature
  ids, the two routes, the page, drawer, and injection spot are **net-new additions**, not
  changes to existing ids.
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
  a small bounded failed window, and a small bounded last-X inspector window.
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
| Backward compatibility: all `@open-mercato/queue` changes additive-only | ☐ deferred | `delayed?`, `getFailedJobsSummary?`, `getRecentJobs?` optional; no removed/renamed export, no event-id change. |
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
