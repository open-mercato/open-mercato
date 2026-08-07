# Events worker subscriber registry: dispatch through the DI event bus

## TLDR

**Key Points:**
- The events worker resolves subscribers from `getCliModules()`, a registry populated **only** by the `mercato` bin. In any process where `registerCliModules()` did not run, the worker gets `[]`, returns early, and marks the job COMPLETED with no log.
- Under default-on `OM_EVENTS_SINGLE_DELIVERY` the bus already skipped those subscribers inline, so the side effect is lost silently - taking down every wildcard persistent subscriber at once (webhooks outbound dispatch, workflow event triggers, business-rule CRUD triggers).
- The worker already receives `ctx.resolve` bound to a per-job DI container whose `eventBus` has every module subscriber registered. Dispatch through that bus instead of a private registry.
- Delivery semantics are deliberately left alone: the queue is durable, so "no worker yet" is delayed, not lost.

**Scope:**
- `packages/events`: new `EventBus.dispatchQueued`, worker rewrite, per-job delivery stamp.
- `packages/shared`: CI guard forbidding runtime reads of the CLI module registry.
- `packages/core`: surface the swallowed `getModules()` failure in bootstrap.

**Concerns:**
- `EventBus` is a contract surface; the change must be additive.
- The stamp changes what `OM_EVENTS_SINGLE_DELIVERY=false` means (inline-only, no longer dual-dispatch).

## Problem Statement

`OM_EVENTS_SINGLE_DELIVERY` defaults ON. On a `persistent: true` emit the bus skips persistent
subscribers inline (`packages/events/src/bus.ts:216-219`, `:308-312`) and enqueues the event, making
the events worker the sole dispatcher.

The worker builds its own subscriber map from `getCliModules()`
(`packages/events/src/modules/events/workers/events.worker.ts:2,89`), which is populated only by
`registerCliModules()` from the `mercato` bin (`packages/cli/src/bin.ts:67`,
`packages/cli/src/mercato.ts:1081`, `:1441`).

1. `events.worker.ts` is the only non-CLI runtime file importing `getCliModules()`. The remaining
   callers are `packages/core/src/modules/auth/cli.ts` and `.../entities/cli.ts` - real CLI commands.
2. `getCliModules()` fails open (`packages/shared/src/modules/registry.ts:492-495`), so an
   unregistered process silently produces zero subscribers and `handle()` returns at
   `events.worker.ts:121`. The job is marked COMPLETED - not retried, not dead-lettered, not logged.
3. The listener map is cached for the process lifetime (`events.worker.ts:77-106`), so an empty map
   computed before registration is pinned forever.
4. `_cliModules` (`packages/shared/src/modules/registry.ts:483`) is a plain module-level variable with
   no `globalThis` backing, unlike the app registry (`packages/shared/src/lib/modules/registry.ts:8-24`),
   so bundler/loader duplication can also produce an empty read.

Secondary gap: `applyEventsSingleDeliveryGuard` runs only at `packages/cli/src/mercato.ts:2182` and
`:2370`. A process started without `mercato server|start` never reconciles the flag.
`reconcileSingleDelivery` / `isExternalWorkerAcknowledged` (`packages/events/src/single-delivery.ts:35,59`)
are dead code at runtime.

## Existing Behavior Findings

- `createPerJobWorkerHandler` (`packages/cli/src/lib/worker-job-handler.ts:34,44`) builds a request
  container per job and binds `ctx.resolve` to it.
- `createRequestContainer` (`packages/shared/src/lib/di/container.ts:159-204`) runs core bootstrap.
- `packages/core/src/bootstrap.ts:146-163` creates the `eventBus` and calls
  `registerModuleSubscribers(...)` with every discovered module subscriber, read from the
  globalThis-backed app registry via `getModules` (`packages/shared/src/lib/i18n/server.ts:10`).
- In the CLI path the app registry is populated **before** the CLI registry, from the same array:
  `queue` is not in `BOOTSTRAP_FREE_COMMANDS` (`packages/cli/src/bin.ts:14-34`), so `tryBootstrap()`
  runs `bootstrapFromAppRoot()` -> `createBootstrap(data)()` -> `registerModules(data.modules)` and
  only then `registerCliModules(data.modules)`.
- The bus registry is a superset of the CLI one by exactly one entry: the programmatic search-delete
  subscriber (`packages/core/src/bootstrap.ts:230-236`). It is `persistent: false`
  (`packages/search/src/indexer/subscribers/delete.ts:11`) and `search.delete_record` is emitted
  without `persistent` (`packages/core/src/modules/query_index/subscribers/delete_one.ts:131`), so no
  job for it ever reaches the worker under either flag state.
- `AUTO_SPAWN_WORKERS` defaults to *enabled* when unset (`packages/cli/src/lib/auto-spawn-workers.ts:11-17`),
  so `!== 'off'` is not a usable worker-availability signal from inside a bare Next process.
- `applyEventsSingleDeliveryGuard` writes an explicit `'true'`/`'false'` into `process.env` and every
  child `runtimeEnv` (`packages/cli/src/lib/events-single-delivery.ts:65-67`). That explicit write is
  a reliable "a supervisor checked worker availability" marker.

## Proposed Solution

### 1. `EventBus.dispatchQueued` owns queued dispatch

Add one additive method to `EventBus`:

```ts
// optional, so the interface change stays ADDITIVE-ONLY
dispatchQueued?(
  event: string,
  payload: EventPayload,
  options?: EmitOptions,
): Promise<QueuedDispatchResult[]>
```

It selects subscribers from the bus's own `listeners` / `persistentSubscribers`: every pattern
matching `event` via `matchEventPattern`, filtered to persistent.

Selection deliberately does **not** read `OM_EVENTS_SINGLE_DELIVERY`. Whether inline delivery already
happened is carried by the job stamp (§3), so the producer owns that decision and a worker whose env
disagrees cannot act on its own copy of the flag. Every job that reaches dispatch wants this
selection: a job is only dispatched when its stamp is false, which means either the producer had
single-delivery on, or the emit was enqueue-only (documented as "every subscriber is persistent").

Handlers run through `withModuleResourceUsage` with the same attribution `deliver()` uses, and
failures are **returned** rather than swallowed (`deliver()` logs and continues, which would break
queue retry). Moving selection onto the bus - and off the worker's env - makes the documented "bus and
worker agree" invariant structural rather than dependent on two processes sharing a flag value.

### 2. The worker dispatches through the bus and fails loud

`events.worker.ts` drops its private registry, cache and pattern matching, resolves `eventBus` from
`ctx.resolve`, and aggregates the returned failures into the existing
`"{n}/{total} subscriber(s) failed for event ..."` throw. When the bus cannot be resolved (or predates
`dispatchQueued`), it throws an actionable error instead of returning - the job then retries and
dead-letters with a visible cause rather than disappearing.

### 3. A per-job delivery stamp

The bus stamps `persistentDeliveredInline: true` on the enqueued job when it ran the persistent
subscribers inline (i.e. single-delivery is off) **and every one of them succeeded**, and the worker
skips such jobs. The success condition matters: inline delivery logs-and-continues, so a persistent
handler that throws there has no retry. Stamping unconditionally would strand it - the worker would
skip a job whose only run failed - silently downgrading persistent delivery to at-most-once in exactly
the configuration `applyEventsSingleDeliveryGuard` selects automatically. Leaving a failed inline run
unstamped hands the retry back to the queue. Delivery mode
becomes a property of the job rather than something each process infers from its own env, so the
producer and the consumer cannot disagree. The stamp only ever suppresses dispatch, so no path
starts running more work, and jobs queued before the upgrade (no stamp) keep the previous behavior.

**Explicitly out of scope:** making the bus reconcile the flag against "is a worker running". An
earlier draft did this and it was wrong: the durable queue means a persistent emit with no worker is
delayed, not lost, and falling back to inline delivery would move the work onto the caller's request
path - exactly what a split app/worker deployment sets `AUTO_SPAWN_WORKERS=false` to avoid. The
`mercato server`/`start` bootstrap keeps its existing guard for a process it *knows* runs no worker.

## Migration & Backward Compatibility

- `dispatchQueued` is an **optional** member of `EventBus`, and `QueuedDispatchResult` is a new type,
  so this stays ADDITIVE-ONLY (`BACKWARD_COMPATIBILITY.md` §2): a custom bus written before this
  release still satisfies the interface. The worker runtime-guards for the member and throws when it
  is absent, so fail-loud does not depend on the type. No existing signature changes.
- `clearListenerCache()` is exported from `events.worker.ts` and stays as a `@deprecated` no-op for at
  least one minor, per the deprecation protocol.
- `persistentDeliveredInline` is optional on the queued job payload, so jobs already sitting in
  `.mercato/queue/` or Redis deserialize unchanged.
- **Behavior change:** `OM_EVENTS_SINGLE_DELIVERY=false` now means inline-only rather than inline
  *and* worker, because the queued job carries the stamp. Recorded in `UPGRADE_NOTES.md`. Delivery
  semantics are otherwise unchanged: the flag is read exactly as before.
- The integration harness pins `OM_EVENTS_SINGLE_DELIVERY: 'false'`
  (`packages/cli/src/lib/testing/integration.ts:3341-3355`); an explicit `false` short-circuits
  `reconcileSingleDelivery` before the availability check, so that suite is unaffected.
- Non-goal: `globalThis`-backing `_cliModules`. After this change no runtime code reads that registry
  outside CLI processes.

### Residual risk: a valid bus with an empty registry

The fail-loud path covers an unresolvable bus and a bus predating `dispatchQueued`. It does **not**
cover a *valid* bus whose registry is empty: `core/bootstrap.ts` logs and continues when `getModules()`
fails, so `dispatchQueued` returns `[]`, no failure is reported, and the job completes green -
indistinguishable from a legitimate "no subscriber for this event".

Severity: low but non-zero. Mitigation: the bootstrap now logs a warning instead of swallowing the
failure, and the worker logs a warning when a queued job dispatches to zero subscribers, so the
condition is visible from two sides. It cannot throw, because zero subscribers is legitimate for an
event nobody listens to. Residual risk: an operator who ignores both warnings still loses the side
effects silently from the queue's point of view.

## Integration Coverage

No API route or UI path changes, so no new Playwright specs. Unit coverage:

- `packages/events/src/__tests__/queued-delivery-roundtrip.test.ts` - the regression, end to end:
  persistent emit -> local file queue -> worker -> subscriber, in a process where
  `registerCliModules()` never ran. Pins the bug by its failure mode rather than by an
  implementation detail.
- `packages/events/src/modules/events/workers/__tests__/events.worker.test.ts` - dispatch through a
  bus with no CLI registry, wildcards, late registration, unresolvable bus and a bus predating
  `dispatchQueued` -> throw, partial failure -> aggregate throw, stamp suppression, and that the
  subscriber context carries the worker's per-job resolver rather than the bus's own.
- `packages/events/src/__tests__/dispatch-queued.test.ts` - selection parity, scope forwarding to
  wildcard subscribers, the subscriber-id fallback, `ok` scoring a `throw undefined` rejection as a
  failure, and the resolver parameter in both directions (caller override honored; omitted falls
  back to the bus's).
- `packages/events/src/__tests__/single-delivery.test.ts` - the stamp in all four combinations,
  including a failed inline persistent handler leaving the job unstamped so the queue keeps its
  retry, while a failed *ephemeral* handler does not.
- `packages/events/src/__tests__/single-delivery-reconcile.test.ts` - unchanged; the reconcile
  helper keeps its existing contract for the CLI bootstrap.
- `packages/cli/src/lib/__tests__/events-single-delivery.test.ts` - the server-bootstrap guard: the
  availability matrix, and that it writes an explicit boolean token into both `process.env` and the
  env handed to spawned children, so app and worker read the same value.
- `packages/shared/src/modules/__tests__/cli-registry-boundary.test.ts` - repo-wide boundary guard:
  no runtime file outside `packages/cli/**` or a module's own `cli.ts` may call `getCliModules()` /
  `hasCliModules()` / `registerCliModules()`. This is what stops the class of bug from returning;
  the rule is recorded in `packages/shared/AGENTS.md` § Never.

## Changelog

- 2026-08-04: Initial spec.
- 2026-08-06: Stamp is now conditional on inline persistent handlers succeeding (review feedback):
  unconditional stamping removed queue retry for the flag-off path, which the CLI guard can select
  automatically. `dispatchQueued` made optional on `EventBus` to keep the type change ADDITIVE-ONLY.
- 2026-08-06: Worker-side selection no longer reads `OM_EVENTS_SINGLE_DELIVERY` (review feedback):
  the flag-off branch was only reachable under producer/worker env skew, where it re-ran ephemeral
  subscribers and missed wildcards. Documented the residual empty-registry path and added a worker
  warning when a queued job dispatches zero subscribers.
- 2026-08-05: Dropped the proposed bus-side reconciliation after testing against a real split
  app/worker deployment showed it would move persistent work onto the HTTP request path. Scope is
  now the worker's subscriber source, the fail-loud path, the delivery stamp, and the CI boundary
  guard.
