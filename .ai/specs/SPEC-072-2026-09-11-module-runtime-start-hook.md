# SPEC-072: Module Runtime Start Hook

## Overview

Give a module a way to start something **once per process**, so a module that owns a long-lived
runtime — a worker loop, a broker subscription, a poller, a watcher — can start it itself instead
of asking every host application to wire it by hand.

Today a module can contribute almost everything else it needs: routes, APIs, CLI commands, DI
registrations, event subscribers, queue workers, entity extensions, setup configuration. The one
thing it cannot contribute is "run this once when the process comes up". Any module needing that
must publish installation instructions telling each host to edit `src/instrumentation.ts`.

This proposes `runtime.ts`, a root convention file alongside the existing `setup.ts`, `acl.ts`,
`ce.ts` and friends.

**Status:** proposed, with a working implementation of the `worker` role in this PR. The `server`
role is specified but deliberately not wired — building it surfaced a constraint that is a
maintainer's call, described under *The `server` role* below.

---

## Problem Statement

### 1. There is no once-per-process extension point

Enumerated against the current `Module` type and the generator's convention files:

| Entry point | When it runs |
|---|---|
| `index.ts`, `acl.ts`, `events.ts`, `ce.ts` | import time, declarative only |
| `setup.ts` (`ModuleSetupConfig`) | applied by `mercato setup` — tenant setup, not process start |
| `di.ts` `register()` | once **per container build**, which in the web tier is per request |
| `subscribers/` | per event delivery |
| `workers/` | per **job**, and only for jobs the scheduler or a caller enqueues |
| `cli.ts` | when a person runs the command |

`di.ts` is the closest and is still wrong: `createRequestContainer()` builds a container per
request, so anything started there would start per request, not per process. A module can work
around it with a module-scoped `let started` guard, but then it starts on the first *request*
rather than at boot — a replica that never receives traffic never starts it, and the work silently
does not happen there.

### 2. The vocabulary exists but nothing emits it

`@open-mercato/shared/lib/runtime/events` already defines:

```ts
applicationLifecycleEvents.bootstrapStarted    // 'application.bootstrap.started'
applicationLifecycleEvents.bootstrapCompleted  // 'application.bootstrap.completed'
applicationLifecycleEvents.bootstrapFailed     // 'application.bootstrap.failed'
```

Nothing in the repository emits them. A module subscribing to `application.bootstrap.completed`
therefore subscribes to an event that never fires unless the host application emits it itself —
which some do, as a local convention. It reads like an extension point and is not one yet.

This spec can be read two ways, and either is fine by us:

- **as proposed** — a `runtime.ts` convention file, symmetrical with `setup.ts`; or
- **as a smaller change** — have `mercato server start` and `mercato queue worker` emit the
  lifecycle events that already exist, and let modules subscribe.

The second is less code. It is written up as the alternative below, with why we lean to the first.

### 3. The cost today falls on every host

A module that needs a process-wide runtime must document a manual edit, and a host that forgets it
gets no error — just work that never happens. That failure is invisible in exactly the way that is
most expensive: the module is installed, its tables are migrated, its API answers, its UI renders,
and nothing runs.

---

## Proposed Design

### The convention file

`src/modules/<module>/runtime.ts`, discovered exactly as `setup.ts` is today
(`resolveConventionFile(discovered.resolve('runtime.ts'), 'RUNTIME', …)` in
`packages/cli/src/lib/generators/module-registry.ts`), surfaced on `Module` as `runtime`.

```ts
// packages/shared/src/modules/runtime.ts

export type ModuleRuntimeRole = 'server' | 'worker' | 'scheduler'

export type ModuleRuntimeContext = {
  /** The process-wide container. Already bootstrapped: DI registrars have run. */
  container: AppContainer
  /** Which process this is. A module may start in some roles and not others. */
  role: ModuleRuntimeRole
  /** Aborted when the process begins shutting down, before `stop()` is awaited. */
  signal: AbortSignal
}

export type ModuleRuntimeHandle = {
  /** Release what `start` acquired. Awaited on shutdown, with a bounded timeout. */
  stop(): Promise<void>
}

export type ModuleRuntime = {
  /**
   * Roles this runtime wants. Defaults to `['server', 'worker']` — the two long-lived
   * processes. A module that must not run twice in one deployment narrows it.
   */
  roles?: ModuleRuntimeRole[]
  start(ctx: ModuleRuntimeContext): Promise<ModuleRuntimeHandle | void>
}
```

```ts
// src/modules/acme/runtime.ts
import type { ModuleRuntime } from '@open-mercato/shared/modules/runtime'

export const runtime: ModuleRuntime = {
  async start({ container, signal }) {
    const worker = await startWorker({ container, signal })
    return { stop: () => worker.stop() }
  },
}

export default runtime
```

### Where it is invoked

**`mercato queue worker --all`** — implemented. Runtimes start after the queue workers are bound
and before the process announces itself up, and their `stop()` is registered with the existing
`registerWorkerShutdownHook`. Zero host wiring: a module that ships `runtime.ts` gets a worker-role
runtime in every deployment that runs this command.

Only on `--all`, which is the process a deployment runs and the one `server start` spawns. A
single-queue worker is a targeted invocation, and starting every module's runtime in each of N of
them would run N copies of each.

`mercato scheduler start` gets the `scheduler` role for symmetry; nothing opts into it yet, and it
is not in the default role set.

### The `server` role — a constraint worth a decision

`mercato server start` is a **supervisor**: it spawns `next start` as a child process, along with
the workers and the scheduler. It is not the application process. A `server`-role runtime started
there would run in the supervisor, without the app's container — the wrong process entirely.

The application process is Next, whose only entry point is the app's own `src/instrumentation.ts`.
Every app in the wild hand-writes that file; there is no shared OM helper it re-exports. So the
`server` role cannot be made zero-wiring the way the worker role can, without deciding one of:

1. **A shared instrumentation helper** — OM exports `startModuleRuntimesForNextjs()`; an app calls
   it once from `instrumentation.ts`. One generic line per app, forever, rather than one per module
   — which is most of the win. Explicit, and starts at boot.
2. **Arm it from `onModulesRegistered()`** (`packages/shared/src/lib/modules/registry.ts`), which
   already fires at the end of every `registerModules()`. Zero wiring — but bootstrap in the web
   tier happens on the first request, so runtimes would start on first traffic rather than at boot,
   and a replica receiving none would never start them. That is a real behavioural difference and
   is why this PR does not simply do it.
3. **Scaffold it** into `create-mercato-app`'s `instrumentation.ts`, which fixes new apps and
   leaves existing ones to a migration note.

(1) is the recommendation — explicit, boot-time, and a single line that never grows. (2) is
tempting and quietly changes when work starts. Guidance welcome; the worker role does not depend
on this choice.

### Contract

1. **Once per process.** The registry is walked once; a module appears at most once.
2. **Ordered by module id**, stably, so a failure is reproducible. No dependency graph — a module
   needing another module's runtime should depend on its service through DI instead.
3. **A throw is fatal to startup.** Deliberately unlike subscribers: a module that cannot start its
   runtime is a broken deployment, and the alternative is a process that looks healthy and silently
   does nothing. `server start` exits non-zero, so an orchestrator rolls back rather than routing
   traffic to it.
4. **`start` should return promptly.** It starts things; it does not *be* the thing. A runtime that
   needs a loop owns its own loop and returns a handle. A `start` that never resolves holds up
   process startup, and the timeout in (6) bounds that.
5. **`stop()` is awaited on SIGTERM/SIGINT**, in reverse start order, before the process exits —
   so a module gets the chance to drain rather than being killed mid-write.
6. **Both are bounded**, by `OM_MODULE_RUNTIME_START_TIMEOUT_MS` and
   `OM_MODULE_RUNTIME_STOP_TIMEOUT_MS` (defaults 30s / 30s). A timeout on start is a start failure
   per (3); a timeout on stop is logged and the process exits anyway, because a shutdown that
   cannot finish must not become a shutdown that never finishes.
7. **Not invoked during `next build`.** The build evaluates application code and must not acquire
   brokers, sockets or leases. Hosts guard this today with
   `process.env.NEXT_PHASE === 'phase-production-build'`; the runner should own it instead.

### Observability

One log line per module on start and stop, at info, with module id, role and duration — because
"which runtimes are up in this process" is the first question when work is not moving, and today it
is unanswerable without reading each module's own logging.

---

## Alternative considered: emit the lifecycle events that already exist

Have `server start` and `queue worker` emit `application.bootstrap.completed`, and let a module
subscribe to it from `subscribers/`.

**For:** no new convention file, no new `Module` field, no generator change. It gives the constants
in `runtime/events.ts` the meaning they currently only imply.

**Against:**

- **No stop.** Subscribers are fire-and-forget; there is nowhere to return a handle, so a module
  cannot drain on shutdown. That is the difference between a rolling deploy that finishes work and
  one that drops it.
- **Failure semantics are wrong.** A throwing subscriber is logged and swallowed, which is right
  for an event and wrong for "this deployment cannot do its job".
- **Role is not expressed.** A subscriber cannot say "server and worker, not the CLI" without
  reading the environment itself, and every module would invent its own way of doing that.
- **It silently does nothing today.** A module written against it works only on hosts that emit the
  event themselves, and fails invisibly elsewhere.

The two are compatible: emitting the lifecycle events is worth doing on its own merits, and a
module runtime is not what they are for.

---

## Implementation

Landed in this PR:

1. `packages/shared/src/modules/runtime.ts` — the types above, plus `moduleRuntimeAppliesTo`.
2. `packages/shared/src/modules/registry.ts` — `runtime?: ModuleRuntime` on `Module`.
3. `packages/cli/src/lib/generators/module-registry.ts` — `runtime.ts` discovered next to
   `setup.ts` in all **three** generator variants (legacy, app, CLI), so whichever registry a
   process reads carries the field.
4. `packages/cli/src/lib/module-runtimes.ts` — `startModuleRuntimes()`, kept out of `mercato.ts`
   so the contract is directly testable: ordering, failure semantics, shutdown and both timeouts
   are the substance of this hook and none of them are reachable through a CLI command in a test.
5. `packages/cli/src/mercato.ts` — wired into `queue worker --all`, with `stop()` on the existing
   `registerWorkerShutdownHook`.
6. `packages/cli/src/__tests__/module-runtimes.test.ts` — 12 tests.

Still to do, once the `server` role question above is settled: the Next-side entry, the module
authoring guide's convention-file list, and `.ai/docs/`.

### Compatibility

Additive. `runtime` is optional, no existing module declares one, and a generated registry without
the field behaves exactly as now.

---

## Motivation

We maintain a module that owns a durable background-work runtime: a job table with leases and
fencing, resumable slices, and a reconciler that adopts orphaned work. The runtime has to exist in
a long-lived process, and there is currently no way for the module to arrange that — so the module
ships instructions telling each host to edit `instrumentation.ts`, and a host that misses the step
gets jobs that are created, leased by nobody, and eventually parked.

The pattern is not specific to that module. Anything that subscribes to a broker, tails a log,
holds a watch or drives a loop meets the same wall.

---

## Changelog

- **2026-09-11** — Initial proposal.
- **2026-09-11** — Implemented the `worker` role end to end (types, `Module.runtime`, discovery in
  all three generator variants, `startModuleRuntimes` + 12 tests, `queue worker --all` wiring).
  Recorded that `mercato server start` is a supervisor, so the `server` role needs a decision
  between a shared instrumentation helper, arming from `onModulesRegistered()`, and scaffolding.
