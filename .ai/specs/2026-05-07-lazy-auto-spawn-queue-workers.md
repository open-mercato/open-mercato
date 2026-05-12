# Lazy Auto-Spawn Queue Workers

## TLDR
**Key Points:**
- The `Memory ... RSS (peak ...)` line printed by the app dev launcher includes the app runtime child process and its descendants, so auto-spawned queue workers are counted in the number.
- Generated worker handlers are already imported lazily, but `AUTO_SPAWN_WORKERS=true` still eagerly starts one long-lived `mercato queue worker --all` process that creates a runner for every discovered queue.
- Add an opt-in lazy auto-spawn mode controlled by `OM_AUTO_SPAWN_WORKERS_LAZY=true`, aligned with the existing `AUTO_SPAWN_WORKERS` switch. In this mode the server starts a lightweight supervisor, and each queue's long-lived worker starts only when the first job is enqueued for that queue.

**Scope:**
- Add lazy worker auto-spawn orchestration to the CLI/server runtime and queue package.
- Preserve `AUTO_SPAWN_WORKERS` eager behavior by default for backward compatibility.
- Support both `QUEUE_STRATEGY=local` and `QUEUE_STRATEGY=async`.
- Document memory accounting, env variables, operational behavior, and testing.

**Concerns:**
- The first job on a cold queue pays worker startup latency.
- Local file queue lazy detection needs a reliable notification/polling bridge without reintroducing one heavy worker process per queue.
- Async Redis/BullMQ mode must avoid creating heavyweight BullMQ `Worker` instances before a job exists.

## Overview
Open Mercato's unified app entrypoints currently auto-start the app server, queue workers, and the local scheduler. The queue worker path is convenient, but it is expensive in development and small deployments because `mercato queue worker --all` starts processing infrastructure for every discovered queue even when most queues are idle.

The immediate user report is high memory pressure during `yarn dev`:

```text
Memory 12.0 GB RSS (peak 20.3 GB)
```

Repository inspection shows that this metric is produced by `apps/mercato/scripts/dev.mjs` using a process-tree RSS walk rooted at the spawned app runtime process. The runtime process then spawns the auto worker process from `packages/cli/src/mercato.ts`, so worker RSS is included in the reported memory.

**Market Reference:** BullMQ, Sidekiq, and Celery all treat workers as separately scalable processes. The proposed design keeps Open Mercato's unified local developer experience but borrows the operational principle that worker processes should be demand-driven or independently managed, not eagerly attached to every app runtime by default.

## Problem Statement
The current auto-spawn model has four problems:

1. `AUTO_SPAWN_WORKERS=true` starts a permanent worker process whenever `server dev` or `server start` runs.
2. `queue worker --all` starts one queue runner per discovered queue. Each runner adds memory overhead even if that queue has no jobs.
3. The dev memory monitor counts those workers because it intentionally measures the whole app runtime process tree.
4. The existing generated `createLazyModuleWorker()` only defers importing a worker handler module until a job is processed. It does not defer starting the queue runner, timers, request container, Redis/BullMQ worker, or process lifetime.

This makes idle modules expensive. As the platform adds integration, notification, sync, catalog, shipping, workflow, and scheduler queues, the idle footprint scales with enabled modules rather than actual background activity.

## Existing Behavior Findings
### Memory Accounting
- `apps/mercato/scripts/dev.mjs` calls `startMemoryMonitor(child)` only for the `App runtime` child.
- `getProcessTreeMemoryBytes(rootPid)` runs `ps -axo pid=,ppid=,rss=` and sums RSS for the root process plus descendants.
- `packages/cli/src/mercato.ts` spawns the queue worker process as a child of the server runtime when `AUTO_SPAWN_WORKERS !== 'false'`.
- Therefore auto-spawned workers are counted in `Memory ... RSS (peak ...)`.

### Worker Startup
- `AUTO_SPAWN_WORKERS` defaults to enabled unless set to `'false'`.
- When enabled, `server dev` and `server start` spawn:

```bash
node <mercatoBin> queue worker --all
```

- `queue worker --all` collects all discovered workers, groups them by queue name, creates a shared request container, and calls `runWorker({ background: true })` for each discovered queue.
- `runWorker()` creates the queue implementation and calls `queue.process(handler)`.
- For `QUEUE_STRATEGY=local`, each queue starts a polling timer.
- For `QUEUE_STRATEGY=async`, each queue creates a BullMQ `Worker` and Redis connection resources.

### Existing Lazy Import Boundary
- `modules.cli.generated.ts` wraps worker handlers in `createLazyModuleWorker(() => import(...), id)`.
- This means handler code is loaded lazily at first handled job, but the queue process and per-queue runners are still eager.

## Proposed Solution
Introduce lazy auto-spawn mode as an additive orchestration feature:

```bash
OM_AUTO_SPAWN_WORKERS_LAZY=true yarn dev
```

When both `AUTO_SPAWN_WORKERS` and `OM_AUTO_SPAWN_WORKERS_LAZY` are true:

1. The app runtime starts a lightweight queue auto-spawn supervisor instead of `queue worker --all`.
2. The supervisor watches for the first pending job per discovered queue.
3. When queue `X` first receives a job, the supervisor starts a dedicated long-lived worker process for only queue `X`:

```bash
node <mercatoBin> queue worker X
```

4. The worker remains running for that queue until the app runtime shuts down.
5. Queues that never receive jobs do not start workers, do not create BullMQ workers, and do not add polling intervals.

The design intentionally starts per-queue worker processes rather than dynamically mutating a single `--all` process. This keeps failure isolation and logging clearer: if one queue worker exits, the supervisor can restart or report that queue without disturbing others.

## Design Decisions
| Decision | Rationale |
|----------|-----------|
| Add `OM_AUTO_SPAWN_WORKERS_LAZY` instead of changing `AUTO_SPAWN_WORKERS` semantics | Eager auto-spawn remains backward-compatible. Lazy mode is explicit and easy to disable while stabilizing. |
| Keep `AUTO_SPAWN_WORKERS=false` as the master off switch | Existing production guidance remains valid. Lazy mode never overrides an explicit off switch. |
| Use per-queue child processes in lazy mode | Avoids loading every queue runner in one process and makes queue-level failures observable. |
| Keep generated worker metadata shape unchanged | `workers/*.ts` metadata `{ queue, id?, concurrency? }` is a frozen public contract. |
| Reuse `createLazyModuleWorker()` for handler import laziness | Existing handler-level laziness remains useful and requires no module author changes. |
| Add queue readiness probing APIs rather than ad hoc file/Redis access in the CLI | Queue strategy details stay inside `@open-mercato/queue`. |

## Alternatives Considered
| Alternative | Why Rejected |
|-------------|--------------|
| Change `AUTO_SPAWN_WORKERS` default to false | Saves memory, but breaks the current developer promise that `yarn dev` processes background jobs automatically. |
| Add `AUTO_SPAWN_WORKERS=lazy` tri-state | Compact, but changes the existing boolean contract and complicates current docs/tests. |
| Only reduce worker concurrency | Does not solve the fixed cost of every queue runner, request container, timers, and BullMQ worker objects. |
| Keep one supervisor process and instantiate workers in-process | Still risks accumulating all queue runners in one process over time and has weaker crash isolation. |
| Start workers directly from `queue.enqueue()` | App server code would need process management and child lifecycle logic in request paths, increasing latency and cross-cutting risk. |

## User Stories / Use Cases
- **Developer** wants to run `yarn dev` with background processing available without paying the idle memory cost for every queue.
- **Small deployment operator** wants the unified entrypoint to start workers only when background work actually appears.
- **Module author** wants existing `workers/*.ts` metadata and enqueue helpers to continue working unchanged.
- **Maintainer** wants memory output to remain truthful and to explain whether workers are counted.

## Architecture
### Components
| Component | Package/File | Responsibility |
|-----------|--------------|----------------|
| Dev memory monitor | `apps/mercato/scripts/dev.mjs` | Continue reporting process-tree RSS. Add optional detail that background children are included. |
| Server runtime | `packages/cli/src/mercato.ts` | Resolve env mode and start eager workers, lazy supervisor, or no workers. |
| Lazy worker supervisor | `packages/cli/src/lib/queue-worker-supervisor.ts` | Watch discovered queues, spawn per-queue workers on first pending job, supervise shutdown/restart policy. |
| Queue pending probe | `@open-mercato/queue` | Strategy-aware lightweight pending-job detection. |
| Worker runner | `@open-mercato/queue/worker` | Existing worker execution path, unchanged for module authors. |

### Runtime Flow
#### Eager Mode (Existing)
```text
yarn dev
  -> mercato server dev
    -> next dev
    -> mercato queue worker --all
      -> runWorker(queue A)
      -> runWorker(queue B)
      -> runWorker(queue C)
```

#### Lazy Mode (New)
```text
yarn dev with OM_AUTO_SPAWN_WORKERS_LAZY=true
  -> mercato server dev
    -> next dev
    -> mercato queue supervisor
      -> watch queue A pending count
      -> watch queue B pending count
      -> watch queue C pending count
      -> first job appears on queue B
        -> node mercato queue worker queue-B
```

### Queue Strategy Behavior
#### Local Strategy
- Queue files remain under `.mercato/queue/<queue>/queue.json`.
- The supervisor checks for pending jobs using a queue package probe, not custom CLI file parsing.
- The probe must be lightweight and avoid importing worker handler modules.
- Poll interval defaults to a conservative value, for example `OM_AUTO_SPAWN_WORKERS_LAZY_POLL_MS=1000`.
- The first eligible delayed job should trigger worker start only after `availableAt <= now`.

#### Async Strategy
- The supervisor uses BullMQ queue counts through the queue package probe.
- It must not create BullMQ `Worker` instances while probing.
- The probe checks waiting/delayed counts. Active counts do not trigger a new worker if that queue worker is already running.
- Redis URL resolution continues through `getRedisUrlOrThrow('QUEUE')` where the async queue strategy requires Redis.

### Scheduler Interaction
- Existing behavior starts the scheduler only when `AUTO_SPAWN_SCHEDULER !== 'false'` and `QUEUE_STRATEGY=local`.
- Lazy worker mode should not change scheduler auto-start in the MVP.
- If the scheduler enqueues into a queue, the lazy supervisor should notice that queue and start its worker.
- Future work may add `OM_AUTO_SPAWN_SCHEDULER_LAZY`, but this spec does not require it.

## Configuration
### Environment Variables
| Variable | Default | Scope | Meaning |
|----------|---------|-------|---------|
| `AUTO_SPAWN_WORKERS` | `true` | Existing | Master switch. `false` disables all auto-spawned workers and lazy supervisor. |
| `OM_AUTO_SPAWN_WORKERS` | unset | New alias | Optional Open Mercato-prefixed alias for `AUTO_SPAWN_WORKERS`; if both are set, legacy `AUTO_SPAWN_WORKERS` wins for backward compatibility. |
| `OM_AUTO_SPAWN_WORKERS_LAZY` | `false` | New | Enables lazy auto-spawn when worker auto-spawn is otherwise enabled. |
| `OM_AUTO_SPAWN_WORKERS_LAZY_POLL_MS` | `1000` | New | Supervisor pending-job probe interval. Must clamp to a safe minimum such as `250`. |
| `OM_AUTO_SPAWN_WORKERS_LAZY_RESTART` | `true` | New | Restart a per-queue worker if it exits unexpectedly while jobs are still pending. |
| `QUEUE_STRATEGY` | `local` | Existing | Queue implementation: `local` or `async`. |

### Env Precedence
1. `AUTO_SPAWN_WORKERS=false` disables workers completely.
2. If `AUTO_SPAWN_WORKERS` is unset, `OM_AUTO_SPAWN_WORKERS=false` disables workers.
3. If workers are enabled and `OM_AUTO_SPAWN_WORKERS_LAZY=true`, start the lazy supervisor.
4. Otherwise keep current eager `queue worker --all` behavior.

### Naming Rationale
The user requested an `OM_AUTO...` variable aligned with the existing variable for starting queues. `OM_AUTO_SPAWN_WORKERS_LAZY` preserves the recognizable `AUTO_SPAWN_WORKERS` phrase and adds the `OM_` namespace plus the specific lazy behavior.

## API Contracts
No HTTP API routes are introduced.

### Internal Queue Package Contract
Add an exported helper in `@open-mercato/queue`, for example:

```typescript
export type QueuePendingProbeOptions = {
  connection?: AsyncQueueOptions['connection']
  baseDir?: string
}

export type QueuePendingProbeResult = {
  queueName: string
  pending: number
  delayedReady: number
  delayedFuture: number
}

export async function getQueuePendingProbe(
  queueName: string,
  strategy?: QueueStrategyType,
  options?: QueuePendingProbeOptions,
): Promise<QueuePendingProbeResult>
```

Rules:
- The probe must not call `queue.process()`.
- The probe must not import module worker handlers.
- The probe must use strategy-specific structured reads:
  - local: read queue storage through a queue package helper.
  - async: BullMQ `Queue#getJobCounts()` or equivalent read-only APIs.
- The probe must be additive and exported from stable package entrypoints without removing existing exports.

### Internal CLI Supervisor Contract
Create a CLI library helper, for example:

```typescript
export type LazyWorkerSupervisorOptions = {
  mercatoBin: string
  appDir: string
  runtimeEnv: NodeJS.ProcessEnv
  workers: ModuleWorker[]
  pollMs: number
  restartOnUnexpectedExit: boolean
  onSpawn?: (queueName: string, pid: number) => void
  onExit?: (queueName: string, code: number | null, signal: NodeJS.Signals | null) => void
}

export function startLazyWorkerSupervisor(
  options: LazyWorkerSupervisorOptions,
): {
  close: () => Promise<void>
  startedQueues: ReadonlySet<string>
}
```

## Data Models
No database schema changes.

### In-Memory State
The lazy supervisor keeps process-local state:

| Field | Type | Purpose |
|-------|------|---------|
| `knownQueues` | `Map<string, QueueWorkerGroup>` | Discovered queue metadata grouped by queue name. |
| `startedQueues` | `Set<string>` | Queues whose worker process has been started. |
| `children` | `Map<string, ChildProcess>` | Active worker process per queue. |
| `lastProbeError` | `Map<string, Error>` | Rate-limited error logging for probe failures. |

No state is persisted. On app restart, lazy mode begins cold again and re-probes queues.

## Commands & Events
No domain commands or module events are introduced.

CLI behavior changes:
- `mercato server dev` and `mercato server start` choose between eager and lazy worker auto-spawn.
- Optional explicit command for diagnostics:

```bash
yarn mercato queue supervisor
```

This command is optional for MVP if the supervisor is only used internally by server runtimes. If exposed, it must be documented and tested.

## Migration & Backward Compatibility
- `AUTO_SPAWN_WORKERS` keeps its current default and semantics.
- `queue worker --all` remains available and unchanged.
- `queue worker <queueName>` remains available and unchanged.
- `workers/*.ts` metadata stays `{ queue, id?, concurrency? }`.
- `ModuleWorker` required fields stay unchanged.
- New queue package helper exports are additive.
- No generated file shape changes are required for MVP.
- Documentation should recommend:
  - `AUTO_SPAWN_WORKERS=false` for production where workers are separately managed.
  - `OM_AUTO_SPAWN_WORKERS_LAZY=true` for memory-sensitive development and small unified deployments.

## Implementation Plan
### Phase 1: Verify and Document Current Accounting
1. Add a focused unit test for `getProcessTreeMemoryBytes()` if practical by factoring it into a testable helper, or add CLI runtime tests that assert worker child processes are spawned under the server runtime.
2. Update dev docs to state that memory RSS is process-tree memory and includes auto-spawned workers/scheduler.
3. Update `apps/mercato/scripts/dev.mjs` splash/detail copy if needed to say background services are included in memory.

### Phase 2: Add Env Resolution
1. Add a shared CLI helper to resolve worker auto-spawn mode:

```typescript
type AutoSpawnWorkersMode = 'off' | 'eager' | 'lazy'
```

2. Support `AUTO_SPAWN_WORKERS`, `OM_AUTO_SPAWN_WORKERS`, and `OM_AUTO_SPAWN_WORKERS_LAZY`.
3. Use `parseBooleanToken` / `parseBooleanWithDefault` from `@open-mercato/shared/lib/boolean`.
4. Add unit tests covering env precedence and invalid values.

### Phase 3: Add Strategy-Aware Pending Probe
1. Add read-only pending probe helpers to `packages/queue`.
2. For local queues, reuse queue storage parsing in `packages/queue/src/strategies/local.ts` or extract local storage helpers to avoid duplicate JSON parsing.
3. For async queues, use BullMQ queue count APIs without creating a BullMQ `Worker`.
4. Add tests:
   - local empty queue returns zero pending.
   - local queued job returns pending one.
   - local future delayed job does not count as ready.
   - async probe uses read-only queue APIs and does not start processing.

### Phase 4: Implement Lazy Worker Supervisor
1. Create `packages/cli/src/lib/queue-worker-supervisor.ts`.
2. Group `ModuleWorker[]` by queue and compute concurrency per existing logic.
3. Poll pending probes for queues that are not started.
4. Spawn `node <mercatoBin> queue worker <queueName>` on first ready pending job.
5. Track child process lifecycle and cleanly terminate on server shutdown.
6. Rate-limit probe error logs to avoid noisy output if Redis is temporarily unavailable.
7. Add tests with mocked `spawn` and mocked probe results.

### Phase 5: Wire Server Runtime
1. Replace direct `autoSpawnWorkers` boolean branching in `server dev` and `server start` with `resolveAutoSpawnWorkersMode()`.
2. Keep eager branch identical when mode is `eager`.
3. Add lazy branch that starts the supervisor and pushes its close promise into the existing cleanup lifecycle.
4. Preserve existing "no queues discovered" warning.
5. Update filtered dev output to recognize lazy supervisor logs.

### Phase 6: Documentation and QA
1. Update `apps/docs/docs/framework/events/queue-workers.mdx` with lazy mode examples.
2. Update troubleshooting docs that discuss memory and DB pool sizing.
3. Add release note/changelog entry.
4. Run focused test suites:
   - `yarn test packages/queue`
   - `yarn test packages/cli`
   - targeted dev runtime log tests under `apps/mercato/scripts/__tests__`
5. Manual QA:
   - `OM_AUTO_SPAWN_WORKERS_LAZY=true yarn dev`
   - enqueue a notification job and verify only `notifications` worker starts.
   - enqueue catalog bulk delete and verify catalog worker starts later.
   - confirm memory output drops at idle and rises after queue activation.

## File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `packages/cli/src/lib/auto-spawn-workers.ts` | Create | Env parsing and mode resolution. |
| `packages/cli/src/lib/queue-worker-supervisor.ts` | Create | Lazy queue watcher and per-queue child process management. |
| `packages/cli/src/mercato.ts` | Modify | Wire lazy mode into `server dev` and `server start`. |
| `packages/queue/src/index.ts` | Modify | Export pending probe helpers. |
| `packages/queue/src/strategies/local.ts` | Modify | Extract/read pending local job state safely. |
| `packages/queue/src/strategies/async.ts` | Modify | Expose read-only async pending counts without worker creation. |
| `apps/mercato/scripts/dev.mjs` | Modify | Optional memory copy/log classification for lazy supervisor. |
| `apps/docs/docs/framework/events/queue-workers.mdx` | Modify | Document lazy mode and env variables. |
| `apps/docs/docs/appendix/troubleshooting.mdx` | Modify | Clarify memory and DB pool impact. |
| `packages/cli/src/__tests__/mercato.test.ts` | Modify | Cover mode wiring and spawn behavior. |
| `packages/queue/src/__tests__/*.test.ts` | Modify/Create | Cover pending probes. |

## Testing Strategy
### Unit Tests
- Env resolution:
  - unset env => `eager`.
  - `AUTO_SPAWN_WORKERS=false` => `off`.
  - `OM_AUTO_SPAWN_WORKERS=false` with legacy unset => `off`.
  - `AUTO_SPAWN_WORKERS=true` plus `OM_AUTO_SPAWN_WORKERS_LAZY=true` => `lazy`.
  - `AUTO_SPAWN_WORKERS=false` plus `OM_AUTO_SPAWN_WORKERS_LAZY=true` => `off`.
- Supervisor:
  - does not spawn any child for empty queues.
  - spawns only the queue with ready pending jobs.
  - does not spawn the same queue twice.
  - closes active children on shutdown.
  - restarts only when configured and pending jobs still exist.
- Queue probes:
  - local and async empty/pending/delayed states.
  - probe does not invoke handlers.

### Integration Tests
- CLI integration test for `server dev` with mocked child spawns:
  - eager mode still spawns `queue worker --all`.
  - lazy mode starts supervisor and later spawns `queue worker <queue>`.
- Local queue end-to-end test:
  - start lazy supervisor.
  - enqueue one local job.
  - assert worker process starts and job completes.
- Async queue test where Redis is available in CI/testcontainers:
  - enqueue one BullMQ job.
  - assert lazy supervisor starts only that queue.

### Manual Verification
- Start idle app with `OM_AUTO_SPAWN_WORKERS_LAZY=true`.
- Record idle RSS after warmup.
- Enqueue a single queue job.
- Confirm only that queue worker appears in logs and process tree.
- Compare RSS against eager mode with identical modules enabled.

## Risks & Impact Review
### Data Integrity Failures
#### First Job Stays Queued If Supervisor Misses It
- **Scenario**: A queue receives a job but the supervisor probe fails because of file read errors or Redis outage.
- **Severity**: High
- **Affected area**: Background processing for notifications, sync, integrations, workflows, and other queues.
- **Mitigation**: Keep eager mode as default; lazy mode logs probe failures; supervisor retries on every poll; manual `queue worker <queue>` remains available.
- **Residual risk**: A persistent probe bug can delay lazy jobs until fixed or eager mode is used. Acceptable because lazy mode is opt-in.

#### Duplicate Worker Start Race
- **Scenario**: Two probe cycles or process exits cause two workers for the same queue to start.
- **Severity**: Medium
- **Affected area**: Any queue under lazy supervision.
- **Mitigation**: Keep `startedQueues` and `children` maps; mark queue as starting before spawning; clear only on confirmed exit.
- **Residual risk**: External manual workers may also process the same queue. Queue handlers are already required to be idempotent.

#### Delayed Job Starts Worker Too Early
- **Scenario**: A delayed local job is present but not yet ready; the supervisor starts its worker immediately.
- **Severity**: Low
- **Affected area**: Local delayed jobs.
- **Mitigation**: Pending probe distinguishes ready and future delayed jobs.
- **Residual risk**: Starting early wastes some memory, but does not corrupt data.

### Cascading Failures & Side Effects
#### Supervisor Crash Stops Lazy Queue Activation
- **Scenario**: The lazy supervisor process or in-process helper crashes while the app keeps serving requests.
- **Severity**: High
- **Affected area**: All lazy queues that have not started yet.
- **Mitigation**: In server-managed mode, treat supervisor exit like managed background process failure and surface an error. Keep `AUTO_SPAWN_WORKERS=false` plus external workers as production recommendation.
- **Residual risk**: If operators suppress logs, jobs can wait. Monitoring queue depth remains required.

#### Queue Worker Exit Leaves Queue Idle
- **Scenario**: A per-queue worker exits unexpectedly after starting.
- **Severity**: Medium
- **Affected area**: One queue.
- **Mitigation**: `OM_AUTO_SPAWN_WORKERS_LAZY_RESTART=true` restarts only if pending jobs remain; unexpected exits are logged with queue name.
- **Residual risk**: Crash loops can generate noise. Add backoff if restart loops appear during implementation.

### Tenant & Data Isolation Risks
#### Cross-Tenant Job Handling
- **Scenario**: Lazy mode changes worker process boundaries and accidentally drops tenant/organization context.
- **Severity**: Critical
- **Affected area**: All tenant-scoped workers.
- **Mitigation**: Reuse existing `queue worker <queue>` path and handler context. Do not alter job payloads or module worker contracts.
- **Residual risk**: None introduced beyond existing worker behavior.

#### Noisy Tenant Starts Shared Worker
- **Scenario**: One tenant enqueues a job and starts a shared queue worker that can process jobs for all tenants in that queue.
- **Severity**: Low
- **Affected area**: Shared queue process memory.
- **Mitigation**: This matches existing queue semantics. Lazy mode reduces idle queues but does not attempt tenant-level worker isolation.
- **Residual risk**: Tenant-level isolation of worker processes is out of scope.

### Migration & Deployment Risks
#### Existing Production Deployments Change Behavior
- **Scenario**: Deployments relying on `AUTO_SPAWN_WORKERS=true` accidentally switch to lazy behavior.
- **Severity**: Medium
- **Affected area**: Unified production start, though docs discourage it.
- **Mitigation**: Lazy mode defaults to false and requires `OM_AUTO_SPAWN_WORKERS_LAZY=true`.
- **Residual risk**: Operators may set the new env unintentionally. Documentation must be explicit.

#### Backward Compatibility Contract Break
- **Scenario**: Implementation changes `ModuleWorker`, worker metadata, or generated module shape.
- **Severity**: Critical
- **Affected area**: Third-party modules.
- **Mitigation**: Spec forbids required shape changes; all additions must be optional/additive.
- **Residual risk**: Review must verify generated output before merge.

### Operational Risks
#### Cold-Start Latency
- **Scenario**: First job waits for supervisor poll plus worker process startup.
- **Severity**: Medium
- **Affected area**: User-visible side effects like email, notifications, sync starts.
- **Mitigation**: Keep poll interval low in dev; allow eager mode for latency-sensitive deployments; log when a worker starts because of a queue hit.
- **Residual risk**: Lazy mode trades first-job latency for idle memory savings by design.

#### Memory Savings Are Less Than Expected
- **Scenario**: Most queues become active during a session, so lazy mode eventually starts many workers.
- **Severity**: Low
- **Affected area**: Long-running dev sessions and busy deployments.
- **Mitigation**: Lazy mode optimizes idle and sparse workloads. Memory output remains process-tree RSS so impact stays visible.
- **Residual risk**: A separate future idle-shutdown feature may be needed.

#### Probe Load on Redis or Filesystem
- **Scenario**: Supervisor probes many queues too frequently.
- **Severity**: Medium
- **Affected area**: Redis, filesystem, local dev CPU.
- **Mitigation**: Clamp poll interval; skip already-started queues; group probes; rate-limit errors; consider backoff for empty queues.
- **Residual risk**: Very large module sets may need adaptive polling.

## Final Compliance Report - 2026-05-07
### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/queue/AGENTS.md`
- `packages/cli/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `.ai/skills/spec-writing/SKILL.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Use `@open-mercato/queue`; never custom queues | Compliant | Supervisor uses queue package probes and existing worker commands. |
| root AGENTS.md | Workers metadata `{ queue, id?, concurrency? }` | Compliant | No metadata shape change. |
| packages/queue/AGENTS.md | Workers must be idempotent | Compliant | Existing worker contract remains; lazy mode can create/restart workers so idempotency remains required. |
| packages/queue/AGENTS.md | Test both local and async strategies | Compliant | Testing plan covers both strategies. |
| packages/cli/AGENTS.md | Generated output is authoritative | Compliant | MVP does not require generated shape changes. |
| BACKWARD_COMPATIBILITY.md | Public contracts must be additive | Compliant | New helper exports are additive; existing CLI commands remain. |
| BACKWARD_COMPATIBILITY.md | Function signatures stable | Compliant | Existing exported signatures are not narrowed or removed. |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Findings match code paths | Pass | Memory monitor and auto-spawn process tree are identified. |
| Env names match existing controls | Pass | `OM_AUTO_SPAWN_WORKERS_LAZY` aligns with `AUTO_SPAWN_WORKERS`. |
| Local and async queue strategies covered | Pass | Both have probe behavior and tests. |
| Backward compatibility covered | Pass | Defaults preserve eager behavior. |
| Risks cover operational failure modes | Pass | Probe miss, crash, duplicate spawn, latency, and load are covered. |

### Non-Compliant Items
None.

### Verdict
**Fully compliant:** Approved - ready for implementation.

## Changelog
### 2026-05-07
- Initial comprehensive specification for lazy auto-spawned queue workers.
- Implementation landed: `packages/cli/src/lib/auto-spawn-workers.ts` (env resolver), `packages/queue/src/pending-probe.ts` (read-only local + async probes), `packages/cli/src/lib/queue-worker-supervisor.ts` (per-queue child supervisor), and wiring in `server dev` / `server start` (`packages/cli/src/mercato.ts`). Lazy mode keys `OM_AUTO_SPAWN_WORKERS_LAZY`, `OM_AUTO_SPAWN_WORKERS_LAZY_POLL_MS`, `OM_AUTO_SPAWN_WORKERS_LAZY_RESTART`, and the `OM_AUTO_SPAWN_WORKERS` alias resolve as documented; eager and `AUTO_SPAWN_WORKERS=false` paths are unchanged. Docs updated in `apps/docs/docs/framework/events/queue-workers.mdx` and `apps/docs/docs/appendix/troubleshooting.mdx`.

### Review - 2026-05-07
- **Reviewer**: Codex
- **Security**: Passed
- **Performance**: Passed, with cold-start latency and probe load tracked as explicit risks.
- **Cache**: N/A, no cache behavior changes.
- **Commands**: Passed, existing worker commands remain stable.
- **Risks**: Passed
- **Verdict**: Approved
