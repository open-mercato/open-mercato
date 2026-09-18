# Module Registry Registration Listeners

## TL;DR

`registerModules()` gains a public subscription — `onModulesRegistered(listener)` — so a cache derived
from the module list can drop what it built from an incomplete one. Bootstrap may register an
i18n-only module set before the full list merges in, and a consumer that memoized its resolution in
between serves the pre-merge view for the lifetime of the process (issue #5103). This spec is the
governing contract for that callback: when it fires, what "changed" means, what happens to a
listener that throws or rejects, and how long a listener lives. Everything here is additive — no
existing signature, import path, event id, route, schema, or ACL feature changes.

## Overview

- **Touched code**: `packages/shared/src/lib/modules/registry.ts`,
  `packages/core/src/modules/dashboards/lib/widgets.ts` (first consumer),
  `packages/shared/AGENTS.md`
- **Not touched**: `getModules()` / `tryGetModules()` semantics, the i18n dictionary-cache
  invalidation the registry already performed, `registerModules()`'s synchronous signature,
  `loadWidgetEntries()`'s existing drop-on-empty / drop-on-reject policy
- **Shipped in**: PR #5179, closing [#5103](https://github.com/open-mercato/open-mercato/issues/5103)

## Problem Statement

`invalidateWidgetCache()` existed in the dashboards module and cleared both widget caches, but
nothing in the runtime ever called it — only its own test suite did. Meanwhile `registerModules()`
reconciles more than one registration per boot: `isI18nOnlyRegistration()` / `mergeI18nModules()`
merge an i18n-only registration with the full module list, and after that reconciliation the registry
notified the **i18n dictionary caches only**. It had no mechanism to tell any other module-derived
cache that the world had changed.

`loadWidgetEntries()` self-heals the **empty** and **rejected** resolutions. The case it cannot
recover from is a **non-empty but incomplete** resolution: the widgets of the modules registered so
far, memoized permanently before the rest merge in. #5054 made that state harmless and self-healing
for the empty case and explicitly recorded the remaining window as accepted residual risk. This
change removes the window at its source, in the reconciliation path, so every module-derived cache
can opt in and **no work is added to the request path**.

## The Contract

```typescript
export type ModulesRegisteredListener = (modules: Module[]) => void | PromiseLike<void>

export function onModulesRegistered(listener: ModulesRegisteredListener): () => void
```

### Notification timing

- Listeners are invoked **synchronously**, at the end of `registerModules()`, **after**
  `setGlobalModules()` and after the i18n dictionary caches are invalidated. A listener may therefore
  call `getModules()` and observe the new, reconciled list — that ordering is part of the contract.
- The argument is the **reconciled** module list (post-override, post-i18n-merge), not the raw array
  the caller passed to `registerModules()`.
- `registerModules()` keeps its **synchronous** signature and returns only after every listener has
  been *invoked*. It does not wait for asynchronous work a listener started.
- Listeners are invoked over a snapshot of the subscriber set, so subscribing or unsubscribing from
  inside a listener affects the next notification, never the one in flight.

### Change detection

Listeners fire only when the registered set **actually changed**, so repeated identical bootstraps
and HMR re-registrations do not drop warm caches. "Changed" is decided by comparing an **immutable
registration snapshot** taken at each registration, not by comparing live `Module` references:

- The snapshot records, per module, its `id` and its own top-level contract keys with their values;
  array-valued entries are copied, so their elements are compared one by one.
- Consequently a registration is treated as changed when a module is added, removed or reordered,
  when a top-level contract key is added, removed or reassigned — including an in-place reassignment
  on an existing `Module` object, the HMR shape a reference comparison cannot see — or when the
  contents of an array-valued contract change.
- A contract declared as an **accessor** (getter) is never invoked by the snapshot: it may be lazy,
  side-effectful, or throw before the rest of bootstrap has run. It is recorded as unreadable and
  never compares equal, so its module always counts as changed.
- **The boundary**: mutation *deeper* than a top-level key or an array element — for example mutating
  the fields of a widget descriptor in place — is invisible to the snapshot. A consumer that depends
  on such state owns its own invalidation. The comparison is deliberately biased toward
  over-invalidating: a spurious notification only drops a warm cache, while a missed one serves a
  stale registry until restart.

### Error and async semantics

- The contract is **fail-soft and fire-and-forget on both paths**. A listener that throws
  synchronously is caught, logged through the shared logger, and does not prevent the remaining
  listeners from running or `registerModules()` from completing.
- A listener that returns a promise is **not awaited**; its rejection is observed and logged the same
  way. This is why the return type is `void | PromiseLike<void>`: an unobserved rejection would
  otherwise surface as an unhandled rejection and, under Node's default policy, terminate the
  process — during bootstrap or request-time locale registration.
- Nothing a listener does is allowed to fail `registerModules()`. A subscriber that needs to signal a
  hard failure must do so through its own channel, not by throwing here.

### Listener lifetime and HMR

- `onModulesRegistered` returns an **unsubscribe** function; calling it removes exactly that listener
  and is idempotent.
- Listeners are stored in a `Set` on `globalThis` (`__openMercatoModulesRegistryListeners__`), for the
  same tsx/esbuild module-duplication reason the registry itself uses `globalThis`: the same
  `registry.ts` can be loaded as several module instances when dynamic and static imports mix.
- A module-scope subscription therefore survives `registerModules()` calls but **not** a module
  instance being replaced: under HMR a re-evaluated consumer module registers a *new* listener, and
  the old one stays subscribed until the process restarts (its closure is harmless — it clears a
  cache nobody reads any more). Consumers that subscribe per-instance rather than at module scope
  MUST call the unsubscribe function themselves.
- Tests that register modules MUST clear `__openMercatoModulesRegistry__`,
  `__openMercatoModulesRegistryListeners__` and `__openMercatoModulesRegistrySnapshot__` between
  cases: those globals survive `jest.resetModules()`, and a leftover snapshot suppresses the very
  notification a test asserts on.

## Consumer Guidance

Subscribe at module scope, next to the cache being protected, and keep the callback trivial —
dropping a memoized value, never rebuilding one:

```typescript
import { onModulesRegistered } from '@open-mercato/shared/lib/modules/registry'

onModulesRegistered(() => {
  invalidateWidgetCache()
})
```

Declare the subscription **after** the caches it clears, so it can never observe them in their
temporal dead zone. Do not fetch, index, or await inside a listener: it runs on the bootstrap path,
and any work there is paid on every real registration change.

## Migration & Backward Compatibility

**All changes are additive.** No existing consumer is affected, and no migration is required of
tenants, apps, or third-party modules.

| Surface | Change | Classification |
|---------|--------|----------------|
| Function signatures (§3) | New export `onModulesRegistered(listener)` on `@open-mercato/shared/lib/modules/registry` | ✓ ADDITIVE (new function, no existing signature touched) |
| Type definitions (§2) | New exported type `ModulesRegisteredListener` | ✓ ADDITIVE (new type, no rename) |
| Function signatures (§3) | `registerModules(modules)` — signature, return type and synchronous behavior unchanged; it now also notifies listeners after the reconciliation it already performed | ✓ Behaviour-preserving for existing callers |
| Import paths (§4) | No move; both exports ship from the existing `@open-mercato/shared/lib/modules/registry` path | ✓ No change |
| Event IDs / API routes / DB schema / DI names / ACL features / notification IDs / CLI commands / generated files | None | ✓ No change |

**Compatibility commitments** for the new surface, binding under the repository's deprecation
protocol (`BACKWARD_COMPATIBILITY.md`):

- `onModulesRegistered` MUST keep accepting a single listener argument and MUST keep returning an
  unsubscribe function. New behavior is added through an **optional** second options argument.
- `ModulesRegisteredListener` MUST keep receiving the reconciled `Module[]`. Its return type MUST NOT
  be narrowed back to `void` — a subscriber returning a promise is supported and its rejection is
  observed.
- The fail-soft guarantee is part of the contract: a future change MUST NOT let a listener's throw or
  rejection propagate out of `registerModules()`.
- Notification ordering (after `setGlobalModules()`, so `getModules()` is readable) MUST NOT be moved
  earlier.
- Change detection MAY become **more** sensitive (more notifications) without a deprecation cycle,
  because over-invalidation is safe. It MUST NOT become less sensitive for any case listed above
  without the deprecation protocol, since that direction serves stale caches.
- Removing either export, or the `globalThis` storage key, follows the full deprecation protocol:
  `@deprecated` JSDoc, a bridging re-export for ≥1 minor release, and an `UPGRADE_NOTES.md` entry.

**Rollback**: dropping the subscription in `widgets.ts` restores the previous behavior exactly; the
registry exports are inert when nobody subscribes (`notifyModulesRegistered` iterates an empty set).

## Testing

- `packages/shared/src/lib/modules/__tests__/registry.test.ts` — a listener fires on first
  registration; it fires when an i18n-only registration is merged with the full module list; it stays
  silent when the identical module set is re-registered; it fires when a re-registered module object
  was mutated in place; it fires when an array-valued contract was mutated in place; it stays silent
  for a semantically identical fresh module list; the returned unsubscribe stops further
  notifications; a throwing listener does not break `registerModules()`; a rejecting **async**
  listener is logged instead of leaking an unhandled rejection.
- `packages/core/src/modules/dashboards/__tests__/widgets.test.ts` — the acceptance-criteria sequence
  (i18n-only bootstrap → empty resolution → full module list → widgets visible, with no caller retry
  and no manual `invalidateWidgetCache()`); the partial non-empty resolution that actually regressed;
  and a warm-cache guard proving an identical re-registration does not re-invoke the widget loaders.

## Changelog

- **2026-08-11** — Contract implemented in PR #5179 (`onModulesRegistered`, dashboards subscriber).
- **2026-08-12** — Spec authored in response to strict review of #5179; async-rejection observation,
  snapshot-based change detection, and typed global storage added in the same PR.
