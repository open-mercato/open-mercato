# SPEC-041m — Mutation Lifecycle Hooks (Overview)

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041 — UMES](./SPEC-041-2026-02-24-universal-module-extension-system.md) |
| **Phase** | M (PR 13) |
| **Branch** | `feat/umes-mutation-lifecycle` |
| **Depends On** | Phase E (API Interceptors) |
| **Related** | [SPEC-035 — Mutation Guard](./SPEC-035-2026-02-22-mutation-guard-mechanism.md) |
| **Status** | Draft |

## Sub-Specs

| Sub-Spec | Scope |
|----------|-------|
| [SPEC-041m1 — Mutation Guard Registry](./SPEC-041m1-mutation-guard-registry.md) | Multi-guard registry, entity matching, legacy bridge |
| [SPEC-041m2 — Sync Event Subscribers](./SPEC-041m2-sync-event-subscribers.md) | Lifecycle events (`*.creating`/`*.created`), sync subscriber contract, event runner |
| [SPEC-041m3 — Client-Side Event Filtering](./SPEC-041m3-client-side-event-filtering.md) | Widget operation filter, CrudForm integration |
| [SPEC-041m4 — Command Interceptors](./SPEC-041m4-command-interceptors.md) | Command bus before/after execute + undo hooks, customer save example |

---

## Goal

Evolve the mutation pipeline into a fully extensible, filterable lifecycle system that **reuses the existing event system** as the filtering and discovery mechanism. Solve three gaps:

1. **Mutation Guard is singleton** — only one DI service can validate mutations (currently record-locks). Evolve to a multi-guard registry via auto-discovery (`data/guards.ts`). → [SPEC-041m1](./SPEC-041m1-mutation-guard-registry.md)
2. **Guards can only block, not modify** — guards should be able to transform the mutation payload (e.g., inject default values, normalize data). → [SPEC-041m1](./SPEC-041m1-mutation-guard-registry.md)
3. **CRUD events are async-only** — event subscribers (`subscribers/*.ts`) are fire-and-forget and cannot prevent or modify operations. Extend the existing subscriber pattern with **sync lifecycle events** (`sync: true`) that run inside the mutation pipeline, can block operations, and can modify data. → [SPEC-041m2](./SPEC-041m2-sync-event-subscribers.md)

Also:
- **Command bus is closed** — third-party modules cannot modify how commands (with undo/redo) work. Command Interceptors add before/after hooks for execute and undo. → [SPEC-041m4](./SPEC-041m4-command-interceptors.md)
- **Guard missing on POST (create)** — the CRUD factory only calls guards for PUT/DELETE, not POST. → Fixed in factory modifications below.
- **Inconsistent guard ordering** — PUT calls `beforeUpdate` BEFORE guard; DELETE calls `beforeDelete` AFTER guard. Normalize to a consistent pipeline. → Fixed in factory modifications below.

### Design Principle: Events ARE the Mechanism

Instead of creating a separate `data/crud-handlers.ts` file convention, this spec extends the **existing event system**:

- Event IDs (`customers.person.created`, `example.todo.updated`) are the filter
- Subscribers (`subscribers/*.ts`) are the handlers — with a new `sync: true` metadata flag
- The CRUD factory emits **lifecycle events** (before + after) that sync subscribers can intercept
- No new file convention for handlers. The existing subscriber auto-discovery is reused.

---

## Unified Mutation Pipeline — Full Annotated Data Flow

The complete data flow from UI form to async side-effects, with every extension point annotated by environment, prevent capability, and modify capability. This covers **all three operations** (create, update, delete) unless noted.

### Full Pipeline (19 Steps)

```
 #  │ Env    │ Step                                        │ Prevent? │ Modify? │ Phase
────┼────────┼─────────────────────────────────────────────┼──────────┼─────────┼──────────────
 1  │ CLIENT │ Required field validation (HTML5)            │ ✅ Yes    │ —       │ existing
 2  │ CLIENT │ Custom field validation                      │ ✅ Yes    │ —       │ existing
 3  │ CLIENT │ Client-side Zod schema validation            │ ✅ Yes    │ —       │ existing
 4  │ CLIENT │ Widget onBeforeSave handlers                 │ ✅ Yes    │ headers │ existing (NEW: op filter)
 5  │ CLIENT │ Widget transformFormData pipeline             │ —        │ ✅ Yes   │ Phase C (NEW: op filter)
 6  │ CLIENT │ Widget onSave (custom HTTP logic)            │ ✅ Yes    │ ✅ Yes   │ existing (NEW: op filter)
    │        │                                             │          │         │
    │        │ ═══ HTTP Request ══════════════════════════  │          │         │
    │        │                                             │          │         │
 7  │ SERVER │ Server-side Zod schema validation            │ ✅ Yes    │ —       │ existing
 8  │ SERVER │ API Interceptor `before` hooks               │ ✅ Yes    │ ✅ Yes   │ Phase E
 9  │ SERVER │ Sync before-event subscribers                │ ✅ Yes    │ ✅ Yes   │ Phase M ← NEW
    │        │   (*.creating / *.updating / *.deleting)    │          │         │
10  │ SERVER │ CrudHooks.beforeCreate/Update/Delete         │ ✅ throw  │ ✅ Yes   │ existing
11  │ SERVER │ Mutation Guard Registry `validate`           │ ✅ Yes    │ ✅ Yes   │ Phase M ← EVOLVED
    │        │                                             │          │         │
12  │ SERVER │ ══ Entity Mutation + ORM Flush ════════════  │  —       │ —       │ existing (core)
    │        │                                             │          │         │
13  │ SERVER │ CrudHooks.afterCreate/Update/Delete          │ —        │ —       │ existing
14  │ SERVER │ Mutation Guard Registry `afterSuccess`       │ —        │ —       │ Phase M ← EVOLVED
15  │ SERVER │ Sync after-event subscribers                 │ —        │ —       │ Phase M ← NEW
    │        │   (*.created / *.updated / *.deleted)       │          │         │
16  │ SERVER │ API Interceptor `after` hooks                │ —        │ ✅ resp  │ Phase E
17  │ SERVER │ Response Enrichers                           │ —        │ ✅ resp  │ Phase D
    │        │                                             │          │         │
    │        │ ═══ HTTP Response ═════════════════════════  │          │         │
    │        │                                             │          │         │
18  │ CLIENT │ Widget onAfterSave handlers                  │ —        │ —       │ existing (NEW: op filter)
19  │ ASYNC  │ Event Subscribers (persistent: true/false)   │ —        │ —       │ existing (fire-and-forget)
```

**Legend**:
- **Prevent?** = Can this step block the operation entirely?
- **Modify?** = Can this step change the mutation payload? `headers` = can only modify request headers. `resp` = modifies the HTTP response body, not the entity. `throw` = blocks by throwing an error (not returning ok:false).
- **op filter** = Widget event handlers now support `filter: { operations: ['create', 'update'] }` ([SPEC-041m3](./SPEC-041m3-client-side-event-filtering.md)).

### Capability Matrix

| # | Step | Env | Can Prevent? | Can Modify Payload? | Can Modify Response? | Scope |
|---|------|-----|-------------|--------------------|--------------------|-------|
| 1 | HTML5 required validation | Client | ✅ | — | — | Form-local |
| 2 | Custom field validation | Client | ✅ | — | — | Form-local |
| 3 | Client Zod validation | Client | ✅ | — | — | Form-local |
| 4 | Widget `onBeforeSave` | Client | ✅ | Headers only | — | Cross-module (widget) |
| 5 | Widget `transformFormData` | Client | — | ✅ | — | Cross-module (widget) |
| 6 | Widget `onSave` | Client | ✅ (skip default) | ✅ (custom request) | — | Cross-module (widget) |
| 7 | Server Zod validation | Server | ✅ | — | — | Route-local |
| 8 | API Interceptor `before` | Server | ✅ | ✅ (re-validated) | — | Cross-module (route) |
| 9 | Sync before-event subscriber | Server | ✅ | ✅ (`modifiedPayload`) | — | Cross-module (event) |
| 10 | CrudHooks.before* | Server | ✅ (throw) | ✅ (return modified) | — | Module-local (route) |
| 11 | Mutation Guard `validate` | Server | ✅ | ✅ (`modifiedPayload`) | — | Cross-module (entity) |
| 12 | Entity mutation + flush | Server | — | — | — | Core |
| 13 | CrudHooks.after* | Server | — | — | — | Module-local (route) |
| 14 | Guard `afterSuccess` | Server | — | — | — | Cross-module (entity) |
| 15 | Sync after-event subscriber | Server | — | — | — | Cross-module (event) |
| 16 | API Interceptor `after` | Server | — | — | ✅ (merge/replace) | Cross-module (route) |
| 17 | Response Enricher | Server | — | — | ✅ (additive) | Cross-module (data) |
| 18 | Widget `onAfterSave` | Client | — | — | — | Cross-module (widget) |
| 19 | Async event subscriber | Async | — | — | — | Cross-module (event) |

### Per-Operation Event Coverage

All three CRUD operations emit both before and after lifecycle events. The CRUD factory auto-derives before-events from the existing event config:

| Operation | Before-Event ID | After-Event ID | Guard `operations` |
|-----------|----------------|----------------|-------------------|
| **Create** | `{module}.{entity}.creating` | `{module}.{entity}.created` | `'create'` |
| **Update** | `{module}.{entity}.updating` | `{module}.{entity}.updated` | `'update'` |
| **Delete** | `{module}.{entity}.deleting` | `{module}.{entity}.deleted` | `'delete'` |

**What each step receives per operation**:

| Step | Create | Update | Delete |
|------|--------|--------|--------|
| Sync before-event | `payload` (new data), `resourceId: null` | `payload` (changed fields), `previousData`, `resourceId` | `resourceId`, `previousData` |
| CrudHooks.before* | `input` (new data) | `input` (changed fields), entity loaded | entity loaded |
| Mutation Guard | `mutationPayload`, `resourceId: null` | `mutationPayload`, `resourceId` | `resourceId`, `mutationPayload: null` |
| Sync after-event | `entity_data` (created entity), `resourceId` | `entity_data` (updated entity), `previousData`, `resourceId` | `resourceId`, `previousData` |
| CrudHooks.after* | created entity | updated entity | deleted entity ref |

### Layering Model

```
┌───────────────────────────────────────────────────────────┐
│  Client Layer (Widget handlers + Zod)                      │  Browser — can prevent + modify
│  ┌───────────────────────────────────────────────────────┐ │
│  │  HTTP Layer (API Interceptors)                         │ │  Route-level, cross-module
│  │  ┌───────────────────────────────────────────────────┐ │ │
│  │  │  Event Layer (Sync Subscribers)                    │ │ │  Event-driven, cross-module
│  │  │  ┌───────────────────────────────────────────────┐ │ │ │
│  │  │  │  Module Layer (CrudHooks)                      │ │ │ │  Per-route, module-local
│  │  │  │  ┌───────────────────────────────────────────┐ │ │ │ │
│  │  │  │  │  Gate Layer (Mutation Guards)              │ │ │ │ │  Final validation gate
│  │  │  │  │  ┌───────────────────────────────────────┐ │ │ │ │ │
│  │  │  │  │  │  Core (Entity Mutation + ORM Flush)    │ │ │ │ │ │
│  │  │  │  │  └───────────────────────────────────────┘ │ │ │ │ │
│  │  │  │  └───────────────────────────────────────────┘ │ │ │ │
│  │  │  └───────────────────────────────────────────────┘ │ │ │
│  │  └───────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────┘ │
│  Async Layer (Event Bus — fire-and-forget)                  │  Post-response, non-blocking
└───────────────────────────────────────────────────────────┘
```

**Key insight**: Both client-side (widget `onBeforeSave`, `transformFormData`) and server-side (sync subscribers, guards) can prevent AND modify mutations — but through different mechanisms. The client path requires a widget injection; the server path works without any UI component (purely via `subscribers/*.ts` with `sync: true`).

### When to Use What

| I want to... | Mechanism | Layer | Env | Can Block? | Can Modify? |
|-------------|-----------|-------|-----|------------|-------------|
| **Prevent / Validate** | | | | | |
| Validate from UI before HTTP request | Widget `onBeforeSave` | Client | Browser | ✅ | Headers only |
| Validate at HTTP route level (cross-module) | API Interceptor `before` | HTTP | Server | ✅ | ✅ (re-validated) |
| Validate cross-module before entity save | Sync subscriber `*.creating` | Event | Server | ✅ | ✅ |
| Validate cross-module before entity update | Sync subscriber `*.updating` | Event | Server | ✅ | ✅ |
| Validate cross-module before entity delete | Sync subscriber `*.deleting` | Event | Server | ✅ | ✅ |
| Validate inside owning module | CrudHooks.beforeCreate/Update/Delete | Module | Server | ✅ (throw) | ✅ |
| Policy enforcement (locks, limits, compliance) | Mutation Guard `validate` | Gate | Server | ✅ | ✅ |
| **Modify Data** | | | | | |
| Transform form data before HTTP request | Widget `transformFormData` | Client | Browser | — | ✅ |
| Custom HTTP request (skip default) | Widget `onSave` | Client | Browser | ✅ (skip) | ✅ |
| Transform request at route level | API Interceptor `before` | HTTP | Server | ✅ | ✅ (re-validated) |
| Inject defaults / normalize before save | Sync subscriber `*.creating` | Event | Server | ✅ | ✅ |
| Inject/normalize data without widget | Sync subscriber `*.updating` | Event | Server | ✅ | ✅ |
| Prepare data in owning module | CrudHooks.before* | Module | Server | ✅ (throw) | ✅ |
| Policy-driven data injection | Mutation Guard `validate` | Gate | Server | ✅ | ✅ |
| **Command-Level** | | | | | |
| Modify input before a command runs | Command Interceptor `beforeExecute` | Command | Server | ✅ | ✅ |
| Block undo of a specific command | Command Interceptor `beforeUndo` | Command | Server | ✅ | — |
| Add side-effects after command undo | Command Interceptor `afterUndo` | Command | Server | — | — |
| **React After Mutation** | | | | | |
| Side-effect in owning module (sync) | CrudHooks.after* | Module | Server | — | — |
| Cross-module cleanup/cache invalidation (sync) | Mutation Guard `afterSuccess` | Gate | Server | — | — |
| Cross-module reaction (sync, before response) | Sync subscriber `*.created/updated/deleted` | Event | Server | — | — |
| Transform HTTP response | API Interceptor `after` | HTTP | Server | — | ✅ (response) |
| Enrich response with cross-module data | Response Enricher | Data | Server | — | ✅ (additive) |
| UI-side reaction after save completes | Widget `onAfterSave` | Client | Browser | — | — |
| Async fire-and-forget reaction | Event Subscriber (`sync: false`) | Async | Worker | — | — |

**Two paths to server-side interception**:
- **With widget**: Use widget `onBeforeSave` / `transformFormData` / `onSave` — requires defining a widget injection into a form spot.
- **Without widget**: Use sync event subscribers (`subscribers/*.ts` with `sync: true`) — works purely server-side, no UI component needed. This is the primary mechanism for cross-module logic that should work regardless of which UI renders the form.

### End-to-End Example: Updating a Customer Person

This traces a single `PUT /api/customers/people/:id` through **all 19 steps**, showing which extension points fire and what each module contributes. In this scenario:
- The **example** module injects a "Priority" widget into the customer form
- The **example** module has a sync subscriber that validates email format on customer updates
- The **example** module has a mutation guard that enforces a VIP downgrade policy
- The **sales** module has an async subscriber that recalculates order quotes when a customer changes

```
USER clicks Save on Customer Person form with:
  { firstName: "Jane", primaryEmail: "Jane@Example.COM", _example: { priority: "critical" } }

 #  │ Step                          │ What happens in this example
────┼───────────────────────────────┼──────────────────────────────────────────────────
 1  │ Required field validation      │ ✅ firstName present — passes
 2  │ Custom field validation        │ ✅ No custom field constraints violated
 3  │ Client Zod validation          │ ✅ Email format ok (Zod just checks string)
 4  │ Widget onBeforeSave            │ example priority widget: filter.operations=['update'] → RUNS
    │                               │   priority="critical" but notes are filled → ✅ passes
    │                               │   Returns { ok: true, headers: { 'X-Priority': 'critical' } }
 5  │ Widget transformFormData       │ example priority widget: strips _example.priority from body,
    │                               │   moves it to a custom field key: { "cf:priority": "critical" }
 6  │ Widget onSave                  │ (not defined — default HTTP request proceeds)
    │                               │
    │ ═══ PUT /api/customers/people/:id  { firstName: "Jane", primaryEmail: "Jane@Example.COM", "cf:priority": "critical" }
    │                               │
 7  │ Server Zod validation          │ ✅ All fields match CustomerPersonUpdateSchema
 8  │ API Interceptor before         │ example.log-customer-mutations: logs "PUT /api/customers/people/:id by user X" → passthrough
 9  │ Sync before-event subscriber   │ Event: customers.person.updating
    │                               │   example.validate-customer-email (priority 100):
    │                               │     email "Jane@Example.COM" → valid, returns { modifiedPayload: { primaryEmail: "jane@example.com" } }
    │                               │     Payload is now: { ..., primaryEmail: "jane@example.com" }
10  │ CrudHooks.beforeUpdate         │ customers module: loads current entity, computes diff, runs module-specific prep
11  │ Mutation Guard validate         │ example.vip-downgrade-guard: checks if priority changed from VIP to non-VIP
    │                               │   Current priority is "normal", new is "critical" (upgrade) → ✅ ok
    │                               │   record_locks bridge (priority 0): no active lock → ✅ ok
    │                               │
12  │ Entity mutation + ORM flush    │ Entity saved: { firstName: "Jane", primaryEmail: "jane@example.com", cf:priority: "critical" }
    │                               │
13  │ CrudHooks.afterUpdate          │ customers module: triggers fulltext reindex for this person
14  │ Guard afterSuccess             │ (no guards requested afterSuccess in this case)
15  │ Sync after-event subscriber    │ Event: customers.person.updated
    │                               │   example.audit-customer-change: logs "Person X updated by user Y" to audit table
16  │ API Interceptor after          │ example.add-server-timestamp: merges { _example: { serverTimestamp: "...", processingTimeMs: 42 } }
17  │ Response Enrichers             │ example response enricher: adds _example.todoCount for this customer
    │                               │
    │ ═══ HTTP 200 { id: "...", firstName: "Jane", primaryEmail: "jane@example.com", _example: { serverTimestamp: "...", todoCount: 3 } }
    │                               │
18  │ Widget onAfterSave             │ example priority widget: shows flash "Priority updated to Critical"
19  │ Async event subscriber         │ sales.recalculate-quotes: fires in background, re-prices open quotes for this customer
```

**What this demonstrates**:
- Steps 4-5 (client): Widget validates + transforms data **before** the HTTP request
- Step 9 (server): Sync subscriber normalizes email **without** any widget — purely server-side
- Step 11 (server): Guard enforces a business policy (VIP downgrade) — also purely server-side
- Step 15 (server): Sync after-subscriber writes audit log **before** the HTTP response is sent
- Step 19 (async): Sales module reacts **after** the response — no delay to the user

---

## Factory Modifications

Precise changes required in `packages/shared/src/lib/crud/factory.ts`.

The factory already has `opts.events: CrudEventsConfig` with `{ module, entity }`. It derives lifecycle event IDs:

```typescript
function deriveLifecycleEventIds(events: CrudEventsConfig) {
  const base = `${events.module}.${events.entity}`
  return {
    creating: `${base}.creating`,
    created:  `${base}.created`,
    updating: `${base}.updating`,
    updated:  `${base}.updated`,
    deleting: `${base}.deleting`,
    deleted:  `${base}.deleted`,
  }
}
```

### POST (Create) — Add Guard + Sync Event Calls

Currently: POST has NO mutation guard call and no lifecycle events. Add both:

```typescript
// In POST handler, after Zod parse and before entity creation:

// [NEW] Emit sync before-event: *.creating
if (opts.events) {
  const eventIds = deriveLifecycleEventIds(opts.events)
  const syncResult = await runSyncBeforeEvent(
    collectSyncSubscribers(globalSyncSubscribers, eventIds.creating),
    { eventId: eventIds.creating, entity: resourceKind, operation: 'create', payload: input, ... },
    { resolve: ctx.container.resolve },
  )
  if (!syncResult.ok) return syncResult.response!
  if (syncResult.modifiedPayload) input = { ...input, ...syncResult.modifiedPayload }
}

// Run CrudHooks.beforeCreate (existing — unchanged)
const modified = await opts.hooks?.beforeCreate?.(input, ctx)
if (modified) input = modified

// [NEW] Run mutation guard registry
const guardResult = await runMutationGuards(globalGuards, { ...guardInput, operation: 'create', resourceId: null }, ...)
if (!guardResult.ok) return guardResult.response!
if (guardResult.modifiedPayload) input = { ...input, ...guardResult.modifiedPayload }

// Entity creation (existing — unchanged)
// ...

// After mutation:
await opts.hooks?.afterCreate?.(entity, ctx)
// [NEW] Guard afterSuccess callbacks
// [NEW] Emit sync after-event: *.created
if (opts.events) {
  const eventIds = deriveLifecycleEventIds(opts.events)
  await runSyncAfterEvent(
    collectSyncSubscribers(globalSyncSubscribers, eventIds.created),
    { eventId: eventIds.created, entity: resourceKind, operation: 'create', resourceId: entity.id, entity_data: entity, ... },
    { resolve: ctx.container.resolve },
  )
}
// Existing: de.markOrmEntityChange + flushOrmEntityChanges (async events — unchanged)
```

### PUT (Update) — Add Sync Events, Normalize Guard Position

```typescript
// New order:
// 1. Zod parse
// 2. Sync before-event (*.updating)     ← NEW: cross-module, event-driven
// 3. hooks.beforeUpdate                  ← existing: module-local
// 4. Mutation guard registry             ← EVOLVED: multi-guard
// 5. Entity mutation + flush
// 6. hooks.afterUpdate                   ← existing: module-local
// 7. Guard afterSuccess                  ← EVOLVED: multiple callbacks
// 8. Sync after-event (*.updated)        ← NEW: cross-module, event-driven
// 9. Async events                        ← existing: unchanged
```

### DELETE — Normalize Pipeline + Add Sync Events

Currently: guard runs BEFORE `beforeDelete`. **Normalize** to match PUT ordering:

```typescript
// Current order (INCONSISTENT with PUT):
// 1. mutation guard validate
// 2. hooks.beforeDelete

// New order (normalized):
// 1. Sync before-event (*.deleting)     ← NEW
// 2. hooks.beforeDelete                  ← existing (MOVED before guard, matching PUT)
// 3. Mutation guard registry             ← EVOLVED
// 4. Entity delete + flush
// 5. hooks.afterDelete
// 6. Guard afterSuccess
// 7. Sync after-event (*.deleted)        ← NEW
// 8. Async events                        ← existing: unchanged
```

**Backward compatibility note**: Moving `beforeDelete` before the guard is a behavioral change. In practice this is safe because:
- `beforeDelete` typically does validation/preparation, not side-effects
- This aligns DELETE with PUT behavior, reducing surprise for module authors

### Sync After-Events vs Async Events

The sync after-event subscribers run BEFORE async event emission. This guarantees:
- Sync after-subscribers see the committed entity data
- Sync after-subscribers complete before the HTTP response is sent
- Async subscribers (existing) fire after the response — unchanged behavior

```
Entity mutation + ORM flush
  → CrudHooks.afterX                    (module-local, existing)
  → Guard afterSuccess                  (multi-guard, evolved)
  → Sync after-event subscribers        (NEW — run before response)
  → API Interceptor after               (route-level)
  → Response Enrichers
  → Return HTTP response
  → Async event subscribers             (existing — fire-and-forget)
```

---

## Where to Modify — File-by-File Reference

### New Files

| File | Purpose | Sub-Spec |
|------|---------|----------|
| `packages/shared/src/lib/crud/mutation-guard-registry.ts` | `MutationGuard` interface, `runMutationGuards()`, `matchesEntity()`, `bridgeLegacyGuard()` | [m1](./SPEC-041m1-mutation-guard-registry.md) |
| `packages/shared/src/lib/crud/sync-event-types.ts` | `SyncCrudEventPayload`, `SyncCrudEventResult` types | [m2](./SPEC-041m2-sync-event-subscribers.md) |
| `packages/shared/src/lib/crud/sync-event-runner.ts` | `collectSyncSubscribers()`, `runSyncBeforeEvent()`, `runSyncAfterEvent()` | [m2](./SPEC-041m2-sync-event-subscribers.md) |
| `packages/shared/src/lib/commands/command-interceptor.ts` | `CommandInterceptor` interface, types | [m4](./SPEC-041m4-command-interceptors.md) |
| `packages/shared/src/lib/commands/command-interceptor-runner.ts` | `runCommandInterceptorsBefore`, `runCommandInterceptorsAfter`, undo variants | [m4](./SPEC-041m4-command-interceptors.md) |
| `packages/shared/src/lib/commands/errors.ts` | `CommandInterceptorError` | [m4](./SPEC-041m4-command-interceptors.md) |
| `packages/core/src/modules/example/data/guards.ts` | Example guard: todo-limit | [m1](./SPEC-041m1-mutation-guard-registry.md) |
| `packages/core/src/modules/example/subscribers/auto-default-priority.ts` | Sync before-create subscriber | [m2](./SPEC-041m2-sync-event-subscribers.md) |
| `packages/core/src/modules/example/subscribers/prevent-uncomplete.ts` | Sync before-update subscriber | [m2](./SPEC-041m2-sync-event-subscribers.md) |
| `packages/core/src/modules/example/subscribers/audit-delete.ts` | Sync after-delete subscriber | [m2](./SPEC-041m2-sync-event-subscribers.md) |
| `packages/core/src/modules/example/commands/interceptors.ts` | Example command interceptors | [m4](./SPEC-041m4-command-interceptors.md) |

### Modified Files

| File | What Changes | Lines Affected |
|------|-------------|----------------|
| **`packages/shared/src/lib/crud/factory.ts`** | Add guard registry calls to POST, add sync lifecycle event emission to POST/PUT/DELETE, normalize DELETE ordering | POST: ~1302-1401, PUT: ~1492-1586, DELETE: ~1687-1756 |
| **`packages/shared/src/lib/commands/command-bus.ts`** | Add command interceptor calls in `execute()` and `undo()` | execute: ~171-217, undo: ~219-235 |
| **`packages/shared/src/lib/crud/mutation-guard.ts`** | Add `@deprecated` JSDoc | Lines 60-86 |
| **`packages/shared/src/modules/widgets/injection.ts`** | Add `WidgetInjectionEventFilter` interface | Type definition section |
| **`packages/ui/src/backend/injection/InjectionSpot.tsx`** | Check `filter.operations` before invoking widget event handlers | Event dispatch logic |
| **`packages/ui/src/backend/CrudForm.tsx`** | Pass current operation to injection context; filter widget handlers | Save pipeline |
| **Bootstrap registration** | Split sync/async subscribers; register command interceptors | Bootstrap init file |
| **Generator scripts** (`packages/cli/`) | Discover `data/guards.ts` and `commands/interceptors.ts` | Generator module discovery |

### What Is NOT Needed (vs previous draft)

| Previous Draft | Now | Why |
|---------------|-----|-----|
| `data/crud-handlers.ts` file convention | **Removed** | Use existing `subscribers/*.ts` with `sync: true` |
| `crud-handlers.generated.ts` | **Removed** | Sync subscribers are part of existing `subscribers.generated.ts` |
| `CrudEventHandler` interface | **Removed** | Replaced by sync subscriber handler + `SyncCrudEventResult` |
| `runCrudEventHandlers()` function | **Removed** | Replaced by `runSyncBeforeEvent()` / `runSyncAfterEvent()` |

### Deprecation Plan

```typescript
// packages/shared/src/lib/crud/mutation-guard.ts

/**
 * @deprecated Use MutationGuard registry via data/guards.ts instead.
 * Bridged to the registry internally. Will be removed in a future major version.
 */
export async function validateCrudMutationGuard(...)

/**
 * @deprecated Use MutationGuard registry via data/guards.ts instead.
 * Bridged to the registry internally. Will be removed in a future major version.
 */
export async function runCrudMutationGuardAfterSuccess(...)
```

---

## Backward Compatibility (Consolidated)

| Existing Code | Impact | Action Required |
|--------------|--------|----------------|
| `crudMutationGuardService` DI token | **None** — auto-bridged to registry | None |
| Enterprise record-locks adapter | **None** — bridged via legacy guard | None |
| `CrudHooks.before*` / `CrudHooks.after*` | **None** — same position in pipeline | None |
| `validateCrudMutationGuard()` / `runCrudMutationGuardAfterSuccess()` | **Deprecated** — still works via registry | Add `@deprecated` JSDoc |
| Existing async subscribers (`subscribers/*.ts`) | **None** — `sync` defaults to `false` | None |
| Existing event declarations (`events.ts`) | **None** — before-events auto-derived by factory | None |
| DELETE `beforeDelete` ordering | **Changed** — now runs before guard (was after) | See note in factory mods |
| POST (create) | **New behavior** — guards now run on create | Guards must handle `resourceId: null` |
| Widget `onBeforeSave` handlers | **None** — new `filter` field is optional | None |
| `CommandHandler` interface | **None** — interceptors wrap, not modify | None |
| `commandBus.execute()` callers | **None** — `CommandInterceptorError` extends `Error` | None |
| `commandBus.undo()` callers | **None** — same error propagation | None |
| New `data/guards.ts` | Purely additive | None |
| New `commands/interceptors.ts` | Purely additive | None |
| New sync subscribers | Purely additive — via existing `subscribers/*.ts` | None |

**Estimated scope**: Large — CRUD factory pipeline + CommandBus modifications are the critical path
