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
dispatchQueued(
  event: string,
  payload: EventPayload,
  options?: EmitOptions,
): Promise<QueuedDispatchResult[]>
```

It selects subscribers from the bus's own `listeners` / `persistentSubscribers`:

- single-delivery on -> every pattern matching `event` via `matchEventPattern`, filtered to persistent;
- legacy (flag off) -> exact-match `listeners.get(event)`, all subscribers.

Handlers run through `withModuleResourceUsage` with the same attribution `deliver()` uses, and
failures are **returned** rather than swallowed (`deliver()` logs and continues, which would break
queue retry). Placing the single-delivery branch on the bus makes the documented "bus and worker agree
within a process" invariant structural instead of an env coincidence.

### 2. The worker dispatches through the bus and fails loud

`events.worker.ts` drops its private registry, cache and pattern matching, resolves `eventBus` from
`ctx.resolve`, and aggregates the returned failures into the existing
`"{n}/{total} subscriber(s) failed for event ..."` throw. When the bus cannot be resolved (or predates
`dispatchQueued`), it throws an actionable error instead of returning - the job then retries and
dead-letters with a visible cause rather than disappearing.

### 3. A per-job delivery stamp

The bus stamps `persistentDeliveredInline: true` on the enqueued job when it ran the persistent
subscribers inline (i.e. single-delivery is off), and the worker skips such jobs. Delivery mode
becomes a property of the job rather than something each process infers from its own env, so the
producer and the consumer cannot disagree. The stamp only ever suppresses dispatch, so no path
starts running more work, and jobs queued before the upgrade (no stamp) keep the previous behavior.

**Explicitly out of scope:** making the bus reconcile the flag against "is a worker running". An
earlier draft did this and it was wrong: the durable queue means a persistent emit with no worker is
delayed, not lost, and falling back to inline delivery would move the work onto the caller's request
path - exactly what a split app/worker deployment sets `AUTO_SPAWN_WORKERS=false` to avoid. The
`mercato server`/`start` bootstrap keeps its existing guard for a process it *knows* runs no worker.

## Migration & Backward Compatibility

- `dispatchQueued` and `QueuedDispatchResult` are **additive** to `EventBus` / the package types
  (`BACKWARD_COMPATIBILITY.md` §2 ADDITIVE-ONLY). No existing signature changes.
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

## Integration Coverage

No API route or UI path changes, so no new Playwright specs. Unit coverage:

- `packages/events/src/modules/events/workers/__tests__/events.worker.test.ts` - dispatch through a
  bus with no CLI registry (the regression), wildcards under single-delivery, legacy exact-match,
  late registration, unresolvable bus -> throw, partial failure -> aggregate throw, stamp suppression.
- `packages/events/src/__tests__/single-delivery.test.ts` - availability-signal matrix and the stamp.
- `packages/events/src/__tests__/single-delivery-reconcile.test.ts` - unchanged; the reconcile
  helper keeps its existing contract for the CLI bootstrap.
- `packages/cli/src/lib/__tests__/events-single-delivery.test.ts` - the guard writes the explicit
  `'true'` the bus-side signal accepts.
- `packages/shared/src/modules/__tests__/cli-registry-boundary.test.ts` - repo-wide boundary guard:
  no runtime file outside `packages/cli/**` or a module's own `cli.ts` may call `getCliModules()` /
  `hasCliModules()` / `registerCliModules()`. This is what stops the class of bug from returning;
  the rule is recorded in `packages/shared/AGENTS.md` § Never.

## Changelog

- 2026-08-04: Initial spec.
- 2026-08-05: Dropped the proposed bus-side reconciliation after testing against a real split
  app/worker deployment showed it would move persistent work onto the HTTP request path. Scope is
  now the worker's subscriber source, the fail-loud path, the delivery stamp, and the CI boundary
  guard.
