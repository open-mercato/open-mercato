# Agent Orchestrator — Performance Hardening (Phase 0+1)

## TLDR

**Key Points:**
- Makes the agent-orchestration pipeline sustain the target load of **~12,000 agent runs/day** (1,000 cases × ~12 agents ⇒ ~20 concurrent LLM runs steady-state, 50–100 at peak), which today's defaults miss by ~10×.
- Two tracks. **Track 0 — configuration & deployment (no behavior change):** async queue strategy, dedicated worker fleet sizing, DB connection budget, `OPENCODE_URL` fix in the fullapp compose, a scaling runbook. **Track 1 — small, well-bounded code changes:** a dedicated `workflow-invoke-agent` queue (core, **Ask First**), a wall-clock timeout on the in-process agent path, bounded admission control in `agentRuntime.run`, composite indexes for the operator-hot queries, `created_at DESC` default list ordering, rollup-backed Overview KPIs, server-side Caseload pagination, and debounced SSE-driven refetch.
- Grounded in `.ai/analysis/2026-07-06-agent-orchestration-performance-analysis.md` (2026-07-06); every targeted bottleneck carries file:line evidence there. **No change** to the propose-only contract, disposition, park/resume semantics, or any agent-facing SDK surface.

**Scope:**
- Enterprise: `packages/enterprise/src/modules/agent_orchestrator/` (runtime limits, indexes, list ordering, cockpit reads).
- Core (**Ask First**, flagged in each step): `packages/core/src/modules/workflows/` — route `invoke_agent` jobs to a dedicated queue.
- Shared (**additive only**): optional `list.defaultSort` on `makeCrudRoute`.
- Docs: deployment runbook for worker fleet sizing and queue configuration.

**Concerns (if any):**
- The dedicated queue and its enqueue-site change touch core `workflows` — additive, but a contract-adjacent surface (queue names, worker registration); needs maintainer sign-off per root `AGENTS.md` Ask First. A one-minor-version dual-consume bridge keeps in-flight jobs draining during deploy.
- Changing the *default* sort of `GET /runs` and `GET /proposals` from `id` to `created_at DESC` is an observable response-ordering change for callers that pass no `sortField`. Explicit-sort callers are unaffected; flagged under Migration & Compatibility.
- The admission-control semaphore is **process-local**; the fleet-wide throttle remains the queue worker concurrency. Documented explicitly so nobody mistakes the cap for a cluster-wide limiter.

## Overview

The shipped orchestrator (see `00-IMPLEMENTED-BASELINE.md`) is architecturally sound for scale-out — run correlation is DB-backed (`agent_run_sessions`), workflow resume is signal-driven O(1), and the SSE bridge has a cross-process pg LISTEN/NOTIFY path. What blocks the 12k-runs/day target is operational and tactical, not structural:

1. **Execution slots.** `INVOKE_AGENT` jobs hold a `workflow-activities` worker slot for the *entire* LLM run (`lib/activity-worker-handler.ts:255`), the worker's default concurrency is **1** (`workers/workflow-activities.worker.ts:34-41`), and the default queue backend is the sequential file-based `local` strategy (`packages/queue/src/strategies/local.ts:34`). Capacity math: 12,000 runs × ~60 s ≈ 8.3 slots busy 24/7 (~20 slots across business hours); concurrency 1 caps out near 1,400 one-minute runs/day.
2. **No protection.** The in-process agent path has no timeout (a hung provider call eats a slot forever), and `agentRuntime.run` accepts unbounded concurrent callers (playground, `delegate_agent` fan-out, future Agentic Tasks).
3. **Reads decay.** The Caseload's primary query (`disposition` pending, oldest first) and the runs facets (`status`, `eval_passed`, `confidence`) have no supporting indexes; the default CRUD sort is `id` (UUID) so the cockpit's `pageSize=100` fetches return a biased random sample; every `proposal.*` broadcast makes every connected operator refetch 3 uncached lists.

The metric-rollup backend (F2 of `next/2026-06-24-trace-eval-pr4b-and-followups.md`) is **already shipped on this branch** (`workers/metric-rollup.ts`, `lib/metrics/metricRollupService.ts`, `api/agents/[id]/metrics/route.ts`, `agent_metric_rollups` migration) — contrary to the stale `next/IMPLEMENTATION-TRACE.md` matrix. This spec therefore does **not** implement rollups; it only repoints the cockpit tiles at rollup-backed endpoints (the `TODO(F2 follow-up)` already in `backend/overview/page.tsx`).

Deliberately **out of scope** (Phase 2 of the analysis, future specs): OpenCode container pooling, shared SSE subscription, NOTIFY-based outcome delivery, non-blocking INVOKE_AGENT, async trace ingest, S3 artifact offload (F1), partitioning/retention (F3/gap-19), per-provider LLM rate budgets.

## Problem Statement

1. At default configuration the platform executes agent jobs **sequentially in a single process** — an order of magnitude below the 1,000-cases/day target — and nothing in the repo documents how to configure it otherwise.
2. Minute-long `invoke_agent` jobs and millisecond-fast activities (timers, waits, emails) share one queue, so agent load **starves workflow housekeeping**.
3. A hung in-process agent run **permanently consumes a worker slot**; a burst of direct `agentRuntime.run` callers has **no backpressure** and can exhaust the DB pool and LLM provider limits.
4. The operator Caseload and Overview become **incorrect and slow** as tables grow: unindexed `disposition`/`status` filters, `id`-ordered sampling, client-side pagination capped at 100 rows, KPI tiles computed from that sample, and an N-operators × 3-queries refetch storm per proposal event.
5. The fullapp compose topology **cannot reach the OpenCode container** (`OPENCODE_URL` unset ⇒ defaults to `http://localhost:4096`).

## Proposed Solution

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Dedicated `workflow-invoke-agent` queue + worker in core `workflows`, default concurrency **5**; `workflow-activities` default stays **1** | Slot isolation: LLM jobs can't starve fast activities, and agent throughput is tuned independently (`WORKERS_WORKFLOW_INVOKE_AGENT_CONCURRENCY`). A new queue may ship its own sensible default without changing behavior for existing deployments; raising the existing worker's default would be a fleet-wide behavior change (rejected at the Open Questions gate). |
| One-minor-version **dual-consume bridge**: the old `workflow-activities` worker keeps its `invoke_agent` branch while the enqueue site targets the new queue | In-flight jobs enqueued before a deploy must drain; matches `BACKWARD_COMPATIBILITY.md`'s bridge requirement for contract-adjacent changes. |
| In-process run timeout `OM_AGENT_RUN_TIMEOUT_MS` (default 300 000 ms, mirroring the OpenCode deadline) enforced inside `runInProcess`; timeout ⇒ `failRun` + typed `AgentRunTimeoutError` | The OpenCode path already has a 5-min wall clock (`OM_OPENCODE_RUN_TIMEOUT_MS`); the in-process path has none. Symmetric semantics, one new env var. |
| Admission control in `AgentRuntimeService.run`: process-local global + per-tenant semaphore with a **bounded FIFO wait** then typed `AgentCapacityError` | Chosen at the Open Questions gate over fail-fast: a bounded wait (default 30 s) absorbs bursts without unbounded memory. Process-local is honest and simple — the fleet-wide throttle is worker concurrency; the semaphore protects each process's DB pool and the single OpenCode container from direct-caller bursts. |
| **Nested runs bypass the semaphore.** A run whose `runContext` carries a parent run id (in-process `delegate_agent` children) is admitted unconditionally | A parent holding a slot while its fan-out children wait on the same semaphore is a livelock at saturation. Children execute within the parent's admitted budget; the cap governs top-level entries only. |
| `AgentCapacityError` from a queued `invoke_agent` job **rethrows as a job failure** (queue-level retry ×3 with backoff) instead of failing the workflow step | Capacity is transient; the existing fail-stop treatment (`activity-worker-handler.ts:306-316`) is for deterministic agent errors. Only exhausted retries fail the step. |
| Additive `list.defaultSort?: { field, dir }` option on `makeCrudRoute`; runs/proposals routes set `created_at DESC` | The factory hardcodes `'id'` when no `sortField` is sent (`factory.ts:80-85`). An optional, per-route default is ADDITIVE-ONLY on the shared contract; explicit sorts behave exactly as before. |
| Composite indexes declared on the entities + one enterprise migration; the `eval_passed` facet gets a hand-authored **partial** index | `(org, disposition, created_at)` and `(org, status, created_at)` serve the two hottest operator queries index-only. MikroORM decorators can't express partial indexes, so the migration hand-authors `WHERE eval_passed = false` (tiny, only failed runs). |
| Overview KPIs read a new org-level `GET /metrics/overview` backed by the **shipped** `metricRollupService` (live fallback), plus indexed disposition counts; Caseload switches to server-side pagination | Deletes the sampled-KPI correctness bug and the biggest read amplification without re-implementing anything — the rollup backend already exists. |
| SSE-driven refetch coalesced through a small module-local `useCoalescedReload` hook (default min interval 5 s) | Turns N_operators × 3 queries *per proposal event* into at most one reload per page per interval. UI-only, no event contract change. |
| No new entities, commands, events, or ACL features | This is a hardening pass. All mutations remain the existing audited commands; reads remain feature-gated by the existing `trace.view`/`proposals.view`. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Redis-backed distributed semaphore for a true fleet-wide run cap | Adds a hard Redis dependency to the enterprise module and duplicates what worker concurrency already provides fleet-wide; process-local + documented multiplication (`cap × replicas`) is sufficient for this phase. |
| Non-blocking INVOKE_AGENT (worker starts the OpenCode session and exits; completion drives resume) | The biggest lever long-term, but a genuine execution-model change touching park/resume, failure attribution, and trace ingest — Phase 2 material, its own spec. |
| Raising `workflow-activities` default concurrency | Fleet-wide behavior change for every existing deployment; rejected at the gate in favor of the new queue owning its own default. |
| Materializing runs/proposals into `query_index` to avoid live `count(*)` | The indexes + rollups below make live reads cheap at this scale; index materialization adds write amplification the analysis showed we don't need yet. |

## Architecture

```
                       POST /instances (start)            direct callers (playground,
                                │                         Agentic Tasks worker, scripts)
                                ▼                                   │
                    workflows executor loop                         │
                                │  INVOKE_AGENT step                │
                                ▼                                   │
              enqueue → ┌──────────────────────────┐               │
                        │ workflow-invoke-agent    │               │
                        │ queue (NEW, core)        │               │
                        │ default concurrency 5    │               │
                        └───────────┬──────────────┘               │
                                    ▼                              ▼
                        ┌──────────────────────────────────────────────────┐
                        │ AgentRuntimeService.run                          │
                        │  ├─ admission gate (top-level runs only):        │
                        │  │    global + per-tenant semaphore,             │
                        │  │    bounded FIFO wait → AgentCapacityError     │
                        │  ├─ in-process: deadline race                    │
                        │  │    OM_AGENT_RUN_TIMEOUT_MS → failRun +        │
                        │  │    AgentRunTimeoutError                       │
                        │  └─ opencode: existing 5-min deadline (unchanged)│
                        └──────────────────────────────────────────────────┘

 workflow-activities queue (existing, concurrency 1): timers, emails, API calls,
 sub-workflow resume — PLUS a deprecated invoke_agent branch for one minor
 version (drain bridge), removed per the deprecation protocol.
```

Read path: Overview tiles → `GET /api/agent_orchestrator/metrics/overview` (rollups via `metricRollupService`, live fallback when no rollup row yet) + per-agent tiles → existing `GET /agents/[id]/metrics`. Caseload → `GET /proposals` with server-side `page/pageSize/disposition/sortField`, backed by the new `(organization_id, disposition, created_at)` index. `useAppEvent('agent_orchestrator.proposal.*')` handlers wrap their reload in `useCoalescedReload`.

### Commands & Events

None added or changed. Existing audited commands (`runs.create/complete/fail`, `proposals.create`, `proposals.dispose`) and events (`run.*`, `proposal.*`) are untouched. `AgentRunTimeoutError` flows through the existing `failRun` path (run status `error`, `error_message` set).

## Data Models

No new entities. Index-only changes:

**`AgentRun`** (`data/entities.ts`) — add:
- `@Index agent_runs_org_status_created_idx (organization_id, status, created_at)`
- partial index `agent_runs_eval_failed_idx ON agent_runs (organization_id, created_at) WHERE eval_passed = false`, declared via `@Index({ name, expression })` — the repo's established convention for partial indexes (precedents: `customers`, `api_keys`, `ai_assistant`), which keeps the index in the ORM model and the snapshot (`expression` entry) so future `db:generate` diffs stay aware of it.

**`AgentProposal`** (`data/entities.ts`) — add:
- `@Index agent_proposals_org_disposition_created_idx (organization_id, disposition, created_at)`

One enterprise migration + `.snapshot-open-mercato.json` update (composite entries + the partial's `expression` entry). Runbook note: environments with already-large tables should pre-create these `CONCURRENTLY` before deploying (the migration's `CREATE INDEX` is idempotent via `IF NOT EXISTS`).

## API Contracts

All changes additive:

- `GET /api/agent_orchestrator/metrics/overview` — **new**, read-only. Requires `agent_orchestrator.proposals.view`. Response: `{ window: '24h'|'7d'|'30d', autoApproveRate, pendingCount, oldestPendingAt, runsTotal, dispositionCounts: Record<disposition, number>, source: 'rollup'|'live' }`. Backed by `metricRollupService` rollup rows for the org; falls back to live indexed aggregate queries when no rollup exists yet (`source: 'live'`). Exports `openApi`.
- `GET /api/agent_orchestrator/runs` and `GET /api/agent_orchestrator/proposals` — gain `defaultSort: { field: 'created_at', dir: 'desc' }`; request/response shapes unchanged. Callers passing `sortField` see no difference.
- `POST /api/agent_orchestrator/agents/[id]/run` (playground) — maps `AgentCapacityError` → **429** with `Retry-After` and an i18n message (`agent_orchestrator.errors.capacity`); `AgentRunTimeoutError` → **504-style 422** body with `agent_orchestrator.errors.timeout`. Existing 404/422 behavior unchanged.
- `makeCrudRoute` (`packages/shared/src/lib/crud/factory.ts`) — new **optional** `list.defaultSort?: { field: string; dir: 'asc'|'desc' }`, used only when the request carries no `sortField`/`sort`. Absent ⇒ current `'id'` behavior, so every existing route is bit-for-bit unchanged (ADDITIVE-ONLY per `BACKWARD_COMPATIBILITY.md`).

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `WORKERS_WORKFLOW_INVOKE_AGENT_CONCURRENCY` | `5` | Concurrency of the new dedicated agent-job worker (per worker process). |
| `OM_AGENT_RUN_TIMEOUT_MS` | `300000` | Wall-clock deadline for one in-process agent run. |
| `OM_AGENT_MAX_CONCURRENT_RUNS` | `25` | Process-local cap on concurrently executing top-level agent runs. |
| `OM_AGENT_MAX_CONCURRENT_RUNS_PER_TENANT` | `10` | Per-tenant slice of the same gate. |
| `OM_AGENT_ADMISSION_MAX_WAIT_MS` | `30000` | Max bounded wait before `AgentCapacityError`. |
| `OM_AGENT_ADMISSION_MAX_QUEUE` | `100` | Max waiters per process; beyond ⇒ immediate `AgentCapacityError`. |

**Deployment runbook** (new `apps/docs/docs/deployment/agent-orchestration-scaling.mdx`, linked from the module `AGENTS.md`):
- `QUEUE_STRATEGY=async` (Redis/BullMQ) is **required** for any real agent load; the `local` strategy is sequential and single-process.
- Dedicated worker deployment (`mercato queue worker --all` or per-queue), not `AUTO_SPAWN_WORKERS` in the web process. Sizing math: `runs/day × avg run seconds ÷ business-window seconds` ⇒ slots (the 1,000-case/12-agent reference lands at ~20–30 slots ⇒ e.g. 3 worker replicas × concurrency 10).
- DB connection budget: `Σ(worker concurrency)` is clamped to `OM_WORKERS_DB_CONNECTION_BUDGET` (default `DB_POOL_MAX`) — raise it or front Postgres with pgbouncer, and verify the clamp didn't silently reduce configured concurrency (the worker logs the effective value).
- `OPENCODE_URL` must point at the OpenCode service name in containerized topologies; `OM_OPENCODE_RUN_TIMEOUT_MS` is the OpenCode ceiling.
- Monitoring checklist: queue depth + oldest-job age per queue, active `agent_runs` (`status='running'`), 429/`AgentCapacityError` rate, DB pool saturation, OpenCode session count.

**Compose fix:** `docker-compose.fullapp.yml` app service gains `OPENCODE_URL=http://opencode:4096` (matching the service name), removing the silent `localhost:4096` default.

## Internationalization (i18n)

New keys in the module's existing locale set (`i18n/{en,es,de,pl}.json`): `agent_orchestrator.errors.capacity`, `agent_orchestrator.errors.timeout`, Overview `source: live` fallback hint, Caseload server-pagination strings if any are net-new. Internal-only throws prefixed `[internal]` per root `AGENTS.md`.

## UI/UX

- **Overview** (`backend/overview/page.tsx`): KPI + trust tiles switch from the client-side 100-row reduction to `GET /metrics/overview` (+ existing per-agent metrics endpoint), resolving the in-code `TODO(F2 follow-up)`. The needs-attention list becomes a windowed, `created_at DESC`, `disposition=pending` server query. A subtle `source: live` hint (existing muted-foreground token) shows when rollups haven't materialized yet.
- **Caseload** (`backend/caseload/page.tsx`): `DataTable` moves to server-side pagination/filter/sort against `/proposals` (page/pageSize/disposition/sortField params — all already supported or added above); the client-side `slice()` over a capped 100-row array is removed, so backlogs beyond 100 become visible and correctly ordered. Status-tab counts come from `metrics/overview.dispositionCounts`.
- Both pages wrap their `useAppEvent` reloads in `useCoalescedReload(reload, { minIntervalMs: 5000 })` (new module-local hook in `components/`).
- No new visual surfaces; all touched lines migrate to semantic DS tokens per the Boy Scout rule. Existing `LoadingMessage`/`ErrorMessage`/`EmptyState` boundaries retained.

## Dependencies & Prerequisites

- **Metric rollups (F2) — SHIPPED on this branch** (`workers/metric-rollup.ts`, `lib/metrics/metricRollupService.ts`, `agent_metric_rollups` migration, `api/agents/[id]/metrics`), despite `next/IMPLEMENTATION-TRACE.md` marking it unbuilt (stale matrix; same class of branch drift that file already documents for the identity overlay). This spec consumes it read-only.
- **Core queue change — Ask First.** The `workflow-invoke-agent` queue + enqueue-site change in `workflows` needs maintainer sign-off before implementation (root `AGENTS.md`).
- No dependency on any unbuilt overlay (guardrails, dispatch, context plane, Agentic Tasks).

## Migration & Compatibility

- Enterprise migration is index-only (additive, no data rewrite). Shared factory change is optional-parameter additive. Core adds one worker file + retargets one enqueue call, with the old worker's `invoke_agent` branch kept as a **deprecated bridge for ≥1 minor version** (`@deprecated` JSDoc + RELEASE_NOTES entry per `BACKWARD_COMPATIBILITY.md`), so jobs enqueued pre-deploy drain normally.
- Observable change: default ordering of `GET /runs` / `GET /proposals` without an explicit `sortField` becomes `created_at DESC` (was insertion-opaque `id`). Documented in RELEASE_NOTES; explicit-sort callers unaffected. The shipped cockpit pages are the only known no-sort consumers and are updated in the same change.
- New env vars all have working defaults; a deployment that changes nothing keeps today's behavior (minus the two bug-class fixes: timeout on hung runs, compose `OPENCODE_URL`).
- Rollout order: Track 0 runbook/config can land and be applied independently; Track 1 phases are individually shippable (see plan).

## Implementation Plan

### Phase 0: Configuration, compose fix, runbook *(no behavior change; independently shippable)*
1. `docker-compose.fullapp.yml`: add `OPENCODE_URL` to the app service.
2. Write `apps/docs/docs/deployment/agent-orchestration-scaling.mdx` (sizing math, queue strategy, connection budget, monitoring checklist); link from `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`.

### Phase 1: Dedicated invoke-agent queue *(core, Ask First)*
1. `packages/core/src/modules/workflows/workers/workflow-invoke-agent.worker.ts` — queue literal `'workflow-invoke-agent'` (string literal per the generator's AST-extraction constraint documented in the existing worker), `id: 'workflows:workflow-invoke-agent'`, concurrency from `WORKERS_WORKFLOW_INVOKE_AGENT_CONCURRENCY` default 5; handler delegates to the existing `handleInvokeAgentJob`.
2. `lib/activity-executor.ts`: `executeInvokeAgent` enqueues to the new queue (`getInvokeAgentQueue()` alongside `getActivityQueue()`).
3. Old worker's `invoke_agent` branch: `@deprecated` bridge note; removal tracked for the following minor version.
4. `yarn generate` (worker auto-discovery); unit test: enqueue targets the new queue; bridge test: an `invoke_agent` job on the old queue still processes.

### Phase 2: Runtime protection *(enterprise)*
1. `lib/runtime/agentRuntime.ts`: deadline race around the in-process model execution; on expiry `failRun(…, 'timeout')` + throw `AgentRunTimeoutError`.
2. `lib/runtime/admission.ts` (new): process-local FIFO semaphore (global + per-tenant, bounded wait/queue per the Configuration table); `AgentRuntimeService.run` acquires for **top-level** runs only (bypass when `runContext` carries a parent run id); release in `finally`.
3. Error mapping: playground route 429 + `Retry-After` for `AgentCapacityError`; `handleInvokeAgentJob` rethrows `AgentCapacityError` as a job failure (queue retry) instead of failing the step; terminal after retries.
4. Unit tests: timeout fails the run exactly once; semaphore admits ≤ caps, FIFO order, per-tenant isolation, nested-run bypass, bounded-wait expiry, release-on-throw.

### Phase 3: Indexes + default ordering *(enterprise + shared additive)*
1. Entity `@Index` additions; migration (with the hand-authored partial index, `IF NOT EXISTS`) + snapshot update.
2. `makeCrudRoute` optional `list.defaultSort` (shared, additive) + unit test (absent ⇒ `'id'`; present ⇒ applied only when the request has no sort).
3. Runs/proposals routes set `defaultSort: { field: 'created_at', dir: 'desc' }`.

### Phase 4: Cockpit reads *(enterprise UI)*
1. `api/metrics/overview/route.ts` — org-level rollup read with live fallback + `dispositionCounts`; `openApi` export.
2. Overview page: tiles → metrics endpoints; needs-attention list → windowed sorted server query.
3. Caseload page: server-side pagination/filter/sort; tab counts from `dispositionCounts`; remove the client slice.
4. `components/useCoalescedReload.ts` + adoption on both pages.
5. i18n keys (en/es/de/pl); `yarn i18n:check-sync`.

### Phase 5: Integration tests + validation gate
Integration coverage below; then `yarn generate && yarn build:packages && yarn typecheck && yarn lint && yarn test`.

## Integration Coverage

> Location: `packages/enterprise/src/modules/agent_orchestrator/__integration__/TC-AGENT-PERF-<NNN>.spec.ts` (+ one core workflows spec for the queue split). Fixtures created via API in setup, cleaned in teardown; no seeded data.

| Path / flow | Must-have tests |
|---|---|
| INVOKE_AGENT via new queue | A workflow with an INVOKE_AGENT step completes end-to-end with the job processed by `workflow-invoke-agent`; a pre-existing job on `workflow-activities` (bridge) also completes |
| `POST /agents/[id]/run` under saturation | With caps forced low via env, the N+1th concurrent playground run returns 429 + `Retry-After`; a queued run admitted within the wait window succeeds |
| In-process timeout | A stub agent exceeding a forced-low `OM_AGENT_RUN_TIMEOUT_MS` yields run `status='error'` with a timeout message; no orphaned `running` row |
| `GET /runs`, `GET /proposals` default order | No `sortField` ⇒ `created_at DESC`; explicit `sortField=confidence` unchanged |
| `GET /metrics/overview` | Returns rollup-backed figures when a rollup row exists (`source:'rollup'`), live aggregates otherwise (`source:'live'`); `dispositionCounts` matches seeded proposals; RBAC `proposals.view` |
| Caseload server pagination | >100 seeded pending proposals paginate across pages oldest-first; disposition tab filter is server-applied |
| SSE coalescing | Burst of `proposal.created` events triggers ≤1 reload per coalescing interval (component test acceptable) |
| **Tenant isolation (mandatory)** | Org B gets 404/403 (never rows) on `metrics/overview` and paginated proposals for org A; the per-tenant semaphore never blocks org B on org A's saturation beyond the global cap |

## Risks & Impact Review

### Risk Register

#### In-flight invoke_agent jobs stranded during the queue cutover
- **Scenario**: Deploy switches the enqueue site to the new queue while jobs sit on `workflow-activities`; if the old branch were removed simultaneously, parked instances would never resume.
- **Severity**: High. **Affected area**: workflows engine.
- **Mitigation**: Dual-consume bridge for ≥1 minor version; integration test proves the old-queue job still processes; RELEASE_NOTES documents the removal timeline.
- **Residual risk**: Low.

#### Semaphore deadlock/livelock via nested or re-entrant runs
- **Scenario**: A parent agent holding a slot fans out `delegate_agent` children that wait on the same semaphore; at saturation nothing progresses.
- **Severity**: High. **Affected area**: `agentRuntime`.
- **Mitigation**: Nested runs (parent run id in `runContext`) bypass the gate — enforced by a dedicated unit test. The gate acquires before any DB write, so a rejected run leaves no `running` row.
- **Residual risk**: Low — OpenCode-native `task` sub-agents run inside OpenCode and never re-enter `agentRuntime.run` (documented baseline limitation), so no hidden re-entrancy path exists today.

#### Process-local cap mistaken for a fleet-wide limit
- **Scenario**: Operators assume `OM_AGENT_MAX_CONCURRENT_RUNS=25` bounds the cluster; with 4 replicas the true bound is 100, overrunning the single OpenCode container.
- **Severity**: Medium. **Affected area**: capacity planning.
- **Mitigation**: Runbook states the multiplication explicitly and directs fleet-wide throttling to worker concurrency; monitoring checklist includes OpenCode session count.
- **Residual risk**: Medium — accepted for this phase; the real fix is the OpenCode pool (Phase 2 of the analysis).

#### Default-sort change surprises an unknown API consumer
- **Scenario**: An external caller relying on implicit `id` ordering of `GET /runs` sees a different first page.
- **Severity**: Low. **Affected area**: two list endpoints.
- **Mitigation**: RELEASE_NOTES entry; explicit `sortField` untouched; implicit `id` order was UUID-opaque (no meaningful contract to preserve).
- **Residual risk**: Low.

#### Index migration on already-large tables locks writes
- **Scenario**: A long-lived deployment with millions of `agent_runs` rows runs the migration; plain `CREATE INDEX` blocks writes for the build duration.
- **Severity**: Medium. **Affected area**: deploy window.
- **Mitigation**: `IF NOT EXISTS` in the migration + runbook instruction to pre-create `CONCURRENTLY` on large live tables (making the migration a no-op).
- **Residual risk**: Low.

### Blast radius
Isolated to: one enqueue call + one new worker (core), the `agentRuntime` entry (guarded by tests for both runtimes), two list routes' *default* ordering, and two cockpit pages. The propose-only pipeline, disposition, resume seam, trace ingest, and all SDK surfaces are untouched.

## Final Compliance Report — 2026-07-06

### AGENTS.md Files Reviewed
Root `AGENTS.md`; `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`; `packages/core/src/modules/workflows/AGENTS.md`; `packages/queue/AGENTS.md`; `packages/shared/AGENTS.md`; `packages/ui/AGENTS.md`; `BACKWARD_COMPATIBILITY.md`; `.ai/specs/AGENTS.md`; `2026-06-19-agent-orchestrator-conventions.md`.

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | Ask First: touching core modules / contract surfaces | Compliant | Core queue change explicitly gated on maintainer sign-off; shared factory change is optional-additive |
| BACKWARD_COMPATIBILITY.md | Bridge for ≥1 minor version on contract-adjacent changes | Compliant | Dual-consume bridge + `@deprecated` + RELEASE_NOTES for the old `invoke_agent` branch |
| root AGENTS.md | Tenant scoping on every query | Compliant | New metrics endpoint and pagination queries are org-scoped; per-tenant semaphore + isolation tests |
| root AGENTS.md | Optimistic locking on new user-editable entities | N/A | No new entities; index-only migration |
| `packages/queue/AGENTS.md` | Durable work via queue workers; never exceed concurrency 20; respect connection budget | Compliant | New worker default 5; runbook covers the budget clamp |
| `packages/core/AGENTS.md` → API Routes | CRUD via `makeCrudRoute`; routes export `openApi` | Compliant | Metrics endpoint is read-only custom GET with `openApi`; list routes unchanged shape |
| `agent_orchestrator/AGENTS.md` | Propose-only pipeline / append-only audit rows never bypassed | Compliant | No mutation-path changes; timeout uses existing `failRun` command |
| `packages/ui/AGENTS.md` | `apiCall`, `DataTable` server mode, DS tokens, Boy Scout rule | Compliant | Specified in UI/UX |
| shared AGENTS.md / root | No hard-coded user-facing strings | Compliant | New error keys in 4 locales; `[internal]` prefix for internal throws |
| `.ai/specs/AGENTS.md` | Enterprise dir, `{date}-{title}.md` naming | Compliant | This file |

### Internal Consistency Check

| Check | Status |
|---|---|
| Data models match API contracts | Pass — index-only; metrics response fields enumerated |
| API contracts match UI/UX | Pass — tiles/pagination map 1:1 to the new/extended endpoints |
| Risks cover all behavioral changes | Pass — cutover, semaphore, sort default, migration, cap semantics |
| Commands defined for all mutations | Pass — no new mutations |
| Integration coverage lists all affected API + UI paths | Pass |

### Verdict
**Fully compliant** — ready for implementation once the core-queue Ask First sign-off is granted.

## Implementation Status

Detailed log: [`2026-07-06-performance-hardening-implementation-log.md`](./2026-07-06-performance-hardening-implementation-log.md).

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 0 — Config, compose fix, runbook | Done | 2026-07-06 | Compose `OPENCODE_URL` verified via `docker compose config`; runbook + sidebar entry; AGENTS.md cross-ref |
| Phase 1 — Dedicated invoke-agent queue (core) | Done | 2026-07-06 | New worker + enqueue retarget + drain bridge + RELEASE_NOTES; 5 new tests; worker in generated registries |
| Phase 2 — Runtime protection | Done | 2026-07-06 | `admission.ts` + in-process deadline + 429/`Retry-After` + retryable rethrow (structural marker, no cross-package import); 16 new tests |
| Phase 3 — Indexes + default ordering | Done | 2026-07-06 | 3 indexes (partial via `@Index({ expression })` convention) + migration + snapshot; `list.defaultSort` additive + routes; 3 new factory tests |
| Phase 4 — Cockpit reads | Done | 2026-07-06 | `GET /metrics/overview` + `useCoalescedReload` + Overview/Caseload server-side rework; 9 new tests |
| Phase 5 — Integration tests + validation gate | Done | 2026-07-06 | 4 Playwright specs + fixtures authored (typecheck + discovery pass; unexecuted — integration env not running); env-gated rows documented in `TC-AGENT-PERF-ENV-README.md`. Gate: `generate` ✅ `build:packages` ✅ `typecheck` 21/21 ✅ `test` 22/22 ✅; `lint` fails only on pre-existing `apps/mercato` errors in untouched files (`OrganizationSwitcher.tsx` rules-of-hooks) |

Implementation deviations (all logged with evidence in the implementation log): partial index moved into the ORM model via the repo's `@Index({ expression })` convention; playground-route error bodies follow that route's existing plain-string pattern (locale keys added for frontend use); exhausted queue retries leave the instance `PAUSED`/parked (job dead-letters; step-level fail-stop does not fire) — accepted trade-off, monitored via queue-depth/failed-jobs; two cockpit tiles whose old numbers were sample-derived artifacts now show explicit "Needs backend" placeholders instead of fabricated aggregates.

## Changelog

### 2026-07-06
- Initial specification. Derived from `.ai/analysis/2026-07-06-agent-orchestration-performance-analysis.md` (Phase 0+1). Open Questions resolved with the maintainer: single spec here with the core change flagged Ask First; metric-rollup implementation excluded (discovered already shipped on this branch — only the cockpit tile repointing is in scope); new queue ships default concurrency 5 while `workflow-activities` stays at 1 (docs-only); admission control uses bounded-wait-then-typed-error semantics.
- Implemented same day (Phases 0–5, coordinated subagents). Data Models section updated to the `@Index({ expression })` partial-index convention discovered during implementation. See Implementation Status + the implementation log for deviations and the Phase 1 follow-up (generator bakes `concurrency: 1` into worker registries when the env ternary is AST-extracted — pre-existing platform limitation).
