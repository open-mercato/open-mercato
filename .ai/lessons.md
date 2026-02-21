# Lessons

# Lessons Learned

Recurring patterns and mistakes to avoid. Review at session start.

## We've got centralized helpers for extracting `UndoPayload`

Centralize shared command utilities like undo extraction in `packages/shared/src/lib/commands/undo.ts` and reuse `extractUndoPayload`/`UndoPayload` instead of duplicating helpers or cross-importing module code.

## Avoid identity-map stale snapshots in command logs

**Context**: Command `buildLog()` in multiple modules loaded the "after" snapshot using the same non-forked `EntityManager` used earlier in `prepare()`. MikroORM's identity map returned cached entities, so `snapshotAfter` matched `snapshotBefore`.

**Problem**: Audit logs showed identical before/after snapshots even when updates occurred, because the EM cache was reused.

**Rule**: In `buildLog()`, always load snapshots using a forked `EntityManager` (or explicitly `refresh: true`). This guarantees a fresh DB read and avoids identity-map caching in logs.

**Applies to**: Any command that captures `snapshotBefore` in `prepare()` and later loads `snapshotAfter` in `buildLog()`.

## Flush entity updates before running relation syncs that query

**Context**: `catalog.products.update` mutates scalar fields and then calls `syncOffers` / `syncCategoryAssignments` / `syncProductTags`, which perform `find` queries. MikroORM auto-flush + subscriber logic reset `__originalEntityData`, resulting in no change sets and no UPDATE being issued.

**Problem**: Updates to the main entity silently did not hit the database when relation syncs executed before the flush.

**Rule**: If an update command mutates scalar fields and then performs relation-sync queries, flush the main entity changes *before* those syncs (or split into two UoWs/transactions).

**Applies to**: Commands that update a core record and then call sync helpers that query/modify relations using the same `EntityManager`.

## Keep create-app template files in lockstep with app shell/layout changes

**Context**: Core app layout behavior was updated in `apps/mercato/src/app/(backend)/backend/layout.tsx`, but equivalent files in `packages/create-app/template/src/app/` were not updated in the same change.

**Problem**: Newly scaffolded apps diverged from monorepo defaults (missing newer navigation/profile/settings wiring and behavior fixes), causing inconsistent UX and harder debugging.

**Rule**: Any change to shared bootstrap/layout shell behavior in `apps/mercato/src/app/**` must include a sync review and required updates in matching `packages/create-app/template/src/app/**` and dependent template components.

**Applies to**: Root layout, backend layout, global providers, header/sidebar wiring, and related template-only wrapper components.

## Store global event bus in `globalThis` to survive module duplication in dev

**Context**: `record_locks` notifications stopped while banners still worked. Banner logic uses direct API polling, but notifications depend on `emitRecordLocksEvent()` from `createModuleEvents()` and the global event bus wiring.

**Problem**: In dev (HMR/Turbopack), duplicated module instances can appear. One instance receives `setGlobalEventBus()` during bootstrap, another instance emits events. With module-local singleton only, emitted events can be dropped silently.

**Rule**: For process-wide runtime singletons used across package boundaries (event bus, similar registries), keep canonical reference in `globalThis` and use module-local variable only as fallback.

**Applies to**: `packages/shared/src/modules/events/factory.ts` and any shared runtime singleton relied on by module auto-discovery/subscriber pipelines.

## Always propagate structured conflict payload from `onBeforeSave` blockers

**Context**: Conflict handling in record locks had two paths: preflight `onBeforeSave` and real mutation `save` response. UI recovered conflict dialog only from save error path.

**Problem**: When conflict was blocked in preflight, users could hit dead-end loops (`Keep editing` / `Keep my changes`) because the dialog state was not rehydrated with full conflict payload.

**Rule**: Any blocking `onBeforeSave` result must carry machine-readable `details` (code + payload), and `CrudForm` must route it through the same global save-error recovery channel as normal save failures.

**Applies to**: Injection widgets that gate save (`WidgetBeforeSaveResult`) and conflict-capable modules (record locks, future optimistic concurrency widgets).
