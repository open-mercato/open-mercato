# SPEC-018: Atomic Phased Flush — Preventing Silent UoW Data Loss & Ensuring Transactional Integrity

## Overview

MikroORM's identity-map and subscriber infrastructure can silently discard pending scalar changes when a query (`em.find`, `em.findOne`, etc.) runs on the same `EntityManager` before an explicit `em.flush()`. Additionally, many command handlers execute multiple `em.flush()` calls without transaction wrapping, creating partial-commit risks when a later flush fails.

This spec defines a framework-level helper — `withAtomicFlush` — that generalizes the original `withEntityFlush` proposal into a **phased, optionally transactional** utility. It replaces the rigid "scalars → relations" two-phase model with an **N-phase pipeline** where each phase is flushed before the next begins, and the entire operation can optionally run inside a database transaction for atomicity.

## Problem Statement

### Problem 1: Silent UoW Data Loss (unchanged from v1)

When an entity tracked by MikroORM's Unit of Work has dirty (unsaved) scalar fields, and a query is executed on the same `EntityManager`, the combination of auto-flush logic and subscriber hooks resets `__originalEntityData`. The subsequent explicit `em.flush()` then sees no changeset and issues no `UPDATE`.

```typescript
// BUG: changes to `record` are silently lost
record.name = 'New Name'
record.status = 'active'
await syncEntityTags(em, record, tags)   // ← internal em.find() resets UoW tracking
await em.flush()                          // ← no UPDATE issued
```

### Problem 2: Partial Commits Without Transactions

Most command handlers use multiple `em.flush()` calls that each commit independently. If flush #2 fails, flush #1 is already committed — leaving the database in an inconsistent state.

```typescript
// RISK: partial commit if second flush fails
entity.status = 'active'
await em.flush()                          // ← committed to DB
await syncEntityTags(em, entity, tags)
await em.flush()                          // ← if this fails, status is 'active' but tags are stale
```

### Problem 3: No Structured Error Handling

Command handlers have no consistent error handling around flush operations. Errors propagate as unstructured exceptions with no context about which phase failed or what was already committed.

### Problem 4: Non-Command API Routes

18 API route handlers perform direct ORM mutations without using the command pattern, missing audit trails, undo support, and flush-ordering safety. These need a migration path.

### Impact

- Affects **execute** methods (update commands) and **undo** handlers across all modules.
- The UoW failure is **silent** — no error thrown, data simply doesn't persist.
- Multiple flushes without transactions risk **partial commits**.
- Every new command is at risk of re-introducing the bug because nothing enforces the boundary.
- 18 API routes bypass commands entirely, missing all safety guarantees.

### Prior Art

The catalog `products.ts` fix (commit `792899ee`) first identified the UoW pattern. Lesson recorded in `.ai/lessons.md` under "Flush entity updates before running relation syncs that query". The `em.transactional()` pattern is already used in `staff/commands/leave-requests.ts`, `entities/lib/register.ts`, and various CLI seed functions.

## Proposed Solution: `withAtomicFlush`

### Name Decision

**Chosen name: `withAtomicFlush`**

| Candidate | Pros | Cons | Verdict |
|-----------|------|------|---------|
| `withAtomicUpdate` | User's suggestion, clear intent | "Update" is too generic — also used for creates, deletes, undo | Runner-up |
| `withAtomicFlush` | Precise about what it controls (flush ordering), conveys atomicity, fits `with*` codebase convention | Slightly ORM-specific | **Selected** |
| `withPhasedFlush` | Emphasizes phases | Doesn't convey transaction/atomicity | Rejected |
| `withSafeFlush` | Emphasizes safety | Vague about mechanism | Rejected |
| `withEntityTransaction` | Clear about transactions | Misses the phase/flush-ordering concern | Rejected |
| `withStagedUpdate` | Emphasizes stages | "Update" too generic | Rejected |

**Rationale**: The function's primary job is controlling **flush boundaries** between phases and optionally wrapping them in a **transaction** for atomicity. `withAtomicFlush` communicates both concerns. It follows the codebase's existing `with*` convention (`withScopedPayload`, `withOnetimeApiKey`, `withFlash`).

### API Design

```typescript
// packages/shared/src/lib/commands/flush.ts

import type { EntityManager } from '@mikro-orm/core'

type FlushPhase = () => void | Promise<void>

interface AtomicFlushOptions {
  /**
   * When true, wraps all phases in em.transactional() so the entire
   * operation is rolled back if any phase fails.
   * Default: false (each phase flushes independently, matching current behavior).
   */
  transaction?: boolean

  /**
   * Optional label for profiling and error context.
   * Example: 'customers.people.update'
   */
  label?: string
}

/**
 * Execute an ordered sequence of mutation phases, flushing the EntityManager
 * between each. Prevents the MikroORM identity-map bug where queries between
 * scalar mutations and flush silently discard the pending changeset.
 *
 * Each phase is a callback that mutates entities or runs sync helpers.
 * After each phase completes, em.flush() is called before the next phase begins.
 *
 * With `transaction: true`, the entire sequence runs inside em.transactional()
 * so all changes are rolled back on failure.
 */
export async function withAtomicFlush(
  em: EntityManager,
  phases: FlushPhase[],
  options?: AtomicFlushOptions,
): Promise<void> {
  if (phases.length === 0) return

  const execute = async (txEm: EntityManager) => {
    for (const phase of phases) {
      await phase()
      await txEm.flush()
    }
  }

  if (options?.transaction) {
    await em.transactional(async (txEm) => {
      // Re-bind phases to use the transactional EM
      // Note: phases close over the outer `em`, which is the same instance
      // that em.transactional() forks. The fork shares the identity map,
      // so mutations on entities already tracked by `em` are visible to `txEm`.
      await execute(txEm)
    })
  } else {
    await execute(em)
  }
}

/**
 * Convenience overload: 2-phase pattern (backward-compatible with original spec).
 * Phase 1: apply scalar mutations. Phase 2: sync relations / run queries.
 */
export async function withAtomicFlush2(
  em: EntityManager,
  applyScalars: FlushPhase,
  syncRelations?: FlushPhase,
  options?: AtomicFlushOptions,
): Promise<void> {
  const phases = [applyScalars]
  if (syncRelations) phases.push(syncRelations)
  return withAtomicFlush(em, phases, options)
}
```

### Transaction Mode: Deep Dive

When `transaction: true` is set, the helper uses `em.transactional()` which:

1. Begins a database transaction
2. Provides a transactional `EntityManager` fork that shares the identity map
3. Each `flush()` inside the transaction emits SQL but does NOT commit
4. On success: commits the entire transaction
5. On failure: rolls back ALL changes across ALL phases

```
+-- transaction: false (default) -----------------------------------+
|                                                                   |
|  Phase 1 -> flush (COMMIT) -> Phase 2 -> flush (COMMIT) -> ...   |
|                                                                   |
|  Warning: If Phase 2 fails, Phase 1 changes are already committed |
+-------------------------------------------------------------------+

+-- transaction: true ----------------------------------------------+
|  BEGIN                                                            |
|  Phase 1 -> flush (no commit) -> Phase 2 -> flush (no commit)    |
|  COMMIT (or ROLLBACK on error)                                    |
|                                                                   |
|  All-or-nothing: If Phase 2 fails, Phase 1 changes are rolled back|
+-------------------------------------------------------------------+
```

### Error Handling Integration

Errors from phases propagate naturally through the existing architecture:

1. **Without transaction**: Error from phase N is thrown. Phases 1..N-1 are committed. The `CommandBus` catches the error, no audit log is persisted, but partial DB changes exist. This matches current behavior.

2. **With transaction**: Error from any phase triggers a full rollback. No partial state. The `CommandBus` catches the error cleanly. The `CrudHttpError` type is preserved for field-level validation errors.

3. **Error context** (future enhancement): The `label` option allows wrapping errors with context:

```typescript
// Future: structured error wrapping
catch (error) {
  throw new AtomicFlushError(
    `Phase ${phaseIndex + 1} failed in ${options.label}`,
    { cause: error, phase: phaseIndex, committed: phaseIndex }
  )
}
```

## Usage Examples

### Usage — execute method (N phases)

```typescript
async execute(rawInput, ctx) {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const record = await em.findOne(CustomerEntity, { id: parsed.id })

  await withAtomicFlush(em, [
    // Phase 1: scalar mutations
    () => {
      record.displayName = parsed.displayName
      record.status = parsed.status
    },
    // Phase 2: relation syncs (queries the DB)
    () => syncEntityTags(em, record, parsed.tags),
    // Phase 3: custom fields (optional, if applicable)
    () => setCustomFieldsIfAny(em, record, parsed),
  ], { transaction: true, label: 'customers.people.update' })
}
```

### Usage — 2-phase convenience (backward-compatible)

```typescript
await withAtomicFlush2(
  em,
  () => {
    record.name = 'New Name'
    record.status = 'active'
  },
  () => syncEntityTags(em, record, tags),
)
```

### Usage — undo handler

```typescript
undo: async ({ logEntry, ctx }) => {
  const payload = extractUndoPayload<PersonUndoPayload>(logEntry)
  const before = payload?.before
  if (!before) return
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const entity = await em.findOne(CustomerEntity, { id: before.entity.id })
  if (!entity) return

  await withAtomicFlush(em, [
    // Phase 1: restore scalar fields
    () => {
      entity.displayName = before.entity.displayName
      entity.status = before.entity.status
    },
    // Phase 2: restore profile + relations
    async () => {
      const profile = await em.findOne(CustomerPersonProfile, { entity })
      if (profile) {
        profile.firstName = before.profile.firstName
        // ... restore all profile fields
      }
      await syncEntityTags(em, entity, before.tagIds)
    },
  ], { transaction: true, label: 'customers.people.update.undo' })
}
```

### Usage — restore functions (sales)

```typescript
async function restoreOrderGraph(em: EntityManager, snapshot: OrderGraphSnapshot) {
  let order = await em.findOne(SalesOrder, { id: snapshot.order.id })
  if (!order) {
    order = em.create(SalesOrder, { ... })
    em.persist(order)
  }

  await withAtomicFlush(em, [
    () => applyOrderSnapshot(order, snapshot.order),
    async () => {
      const existingLines = await em.find(SalesOrderLine, { order: order.id })
      // ... bulk delete + recreate lines
    },
    async () => {
      const existingAdjustments = await em.find(SalesOrderAdjustment, { order: order.id })
      // ... restore adjustments
    },
  ], { transaction: true, label: 'sales.order.restore' })
}
```

## File Layout

```
packages/shared/src/lib/commands/
├── flush.ts              # withAtomicFlush + withAtomicFlush2 (NEW)
├── undo.ts               # extractUndoPayload (existing)
├── index.ts              # re-exports (add flush.ts exports)
└── __tests__/
    └── flush.test.ts     # (NEW)
```

## Affected Locations — Full Audit

### Phase 1: Command handlers requiring migration to `withAtomicFlush`

All locations where the manual two-flush pattern is needed. These must be migrated to `withAtomicFlush`.

#### Already manually patched (must migrate to helper)

These were fixed with raw `em.flush()` calls and should be refactored to use `withAtomicFlush`:

| # | File | Handler | Pattern | Recommend `transaction` |
|---|------|---------|---------|------------------------|
| 1 | `packages/core/src/modules/catalog/commands/products.ts` | execute (update) | Scalars -> `syncOffers` / `syncCategoryAssignments` / `syncProductTags` | `true` |
| 2 | `packages/core/src/modules/catalog/commands/products.ts` | undo (update) | `applyProductSnapshot` -> `restoreOffersFromSnapshot` / `syncCategoryAssignments` / `syncProductTags` | `true` |
| 3 | `packages/core/src/modules/customers/commands/people.ts` | execute (update) | Entity + profile scalars -> `syncEntityTags` | `true` |
| 4 | `packages/core/src/modules/customers/commands/people.ts` | undo (update) | Entity scalars -> `findOne(CustomerPersonProfile)` -> profile scalars -> `syncEntityTags` | `true` |
| 5 | `packages/core/src/modules/customers/commands/companies.ts` | execute (update) | Entity + profile scalars -> `syncEntityTags` | `true` |
| 6 | `packages/core/src/modules/customers/commands/companies.ts` | undo (update) | Entity scalars -> `findOne(CustomerCompanyProfile)` -> profile scalars -> `syncEntityTags` | `true` |
| 7 | `packages/core/src/modules/sales/commands/documents.ts` | `restoreOrderGraph` | `applyOrderSnapshot` -> `find(SalesOrderLine)` / `find(SalesOrderAdjustment)` | `true` |
| 8 | `packages/core/src/modules/sales/commands/documents.ts` | `restoreQuoteGraph` | `applyQuoteSnapshot` -> `find(SalesQuoteLine)` / `find(SalesQuoteAdjustment)` | `true` |
| 9 | `packages/core/src/modules/sales/commands/documents.ts` | execute (updateOrder) | `applyDocumentUpdate` -> `find(SalesOrderLine)` / `find(SalesOrderAdjustment)` | `true` |
| 10 | `packages/core/src/modules/sales/commands/documents.ts` | execute (updateQuote) | `applyDocumentUpdate` -> `resolveStatusEntryIdByValue` / `find(SalesQuoteLine)` | `true` |
| 11 | `packages/core/src/modules/sales/commands/shipments.ts` | `restoreShipmentSnapshot` | Entity scalars -> `find(SalesShipmentItem)` | `true` |
| 12 | `packages/core/src/modules/sales/commands/payments.ts` | `restorePaymentSnapshot` | Entity scalars -> `setRecordCustomFields` / `find(SalesPaymentAllocation)` | `true` |
| 13 | `packages/core/src/modules/resources/commands/resources.ts` | execute (update) | Entity scalars -> `syncResourcesResourceTags` | `true` |
| 14 | `packages/core/src/modules/resources/commands/resources.ts` | undo (update) | Entity scalars -> `syncResourcesResourceTags` | `true` |

#### Already correct (no change needed)

These commands already have the correct flush ordering and do NOT need migration:

| File | Handler | Why safe |
|------|---------|----------|
| `customers/commands/deals.ts` | undo (update) | `em.flush()` before `syncDealPeople` / `syncDealCompanies` |
| `customers/commands/deals.ts` | undo (delete) | Same pattern |
| `resources/commands/resources.ts` | undo (delete) | `em.flush()` before `syncResourcesResourceTags` |
| `auth/commands/users.ts` | undo (update) | `em.flush()` before `syncUserRoles` |
| `auth/commands/users.ts` | undo (delete) | Same |
| `auth/commands/roles.ts` | undo (update/delete) | Uses `de.updateOrmEntity()` or flush before queries |
| `directory/commands/organizations.ts` | undo (delete) | `em.flush()` before `restoreChildParents` |

#### Safe — no relation syncs or queries between scalars and flush

All other command files were audited and confirmed safe. They either:
- Set scalar fields then immediately `em.flush()` with no queries in between
- Only create/delete entities (no update-then-query pattern)
- Use `em.nativeDelete` / `em.nativeUpdate` which bypasses the identity map

Modules confirmed safe: catalog (categories, offers, optionSchemas, priceKinds, prices, variants), currencies, dictionaries, feature_toggles, planner (all availability commands), resources (resource-types, tag-assignments, activities, comments), sales (configuration, notes, tags, statuses), staff (all commands), customers (todos, dictionaries, tags, activities, addresses, comments).

### Phase 2: Non-command API routes requiring migration to commands

These API routes perform direct ORM mutations on form save without using the command pattern. They miss audit trails, undo support, and flush-ordering safety. Each should be migrated to use a registered command with `withAtomicFlush` inside.

#### CRITICAL (affects security/RBAC — migrate first)

| # | File | Operation | What it does |
|---|------|-----------|-------------|
| 1 | `packages/core/src/modules/auth/api/roles/acl/route.ts` | PUT | Creates/updates `RoleAcl` via `em.create()` + `em.persistAndFlush()` — modifies role permissions |
| 2 | `packages/core/src/modules/auth/api/users/acl/route.ts` | PUT | Creates/updates/deletes `UserAcl` — modifies per-user permissions |

#### HIGH (affects core business logic)

| # | File | Operation | What it does |
|---|------|-----------|-------------|
| 3 | `packages/core/src/modules/sales/api/quotes/accept/route.ts` | POST | Updates `SalesQuote` status/token before command dispatch — state mismatch risk |
| 4 | `packages/core/src/modules/sales/api/quotes/send/route.ts` | POST | Updates `SalesQuote` validUntil/sentAt/status via direct mutation |
| 5 | `packages/core/src/modules/dashboards/api/roles/widgets/route.ts` | PUT | Creates/updates/deletes `DashboardRoleWidgets` |
| 6 | `packages/core/src/modules/dashboards/api/users/widgets/route.ts` | PUT | Creates/updates/deletes `DashboardUserWidgets` |

#### MEDIUM (affects features/configuration)

| # | File | Operation | What it does |
|---|------|-----------|-------------|
| 7 | `packages/core/src/modules/dashboards/api/layout/route.ts` | PUT | Updates `DashboardLayout` entities |
| 8 | `packages/core/src/modules/dashboards/api/layout/[itemId]/route.ts` | PATCH | Updates `DashboardLayout.layoutJson` item |
| 9 | `packages/core/src/modules/perspectives/api/[tableId]/route.ts` | POST | Creates/updates `Perspective` via service |
| 10 | `packages/core/src/modules/perspectives/services/perspectiveService.ts` | Various | `saveUserPerspective`, `deleteUserPerspective`, `saveRolePerspectives` — multiple entity ops |
| 11 | `packages/core/src/modules/dictionaries/api/route.ts` | POST | Creates `Dictionary` via `em.create()` + `em.flush()` |
| 12 | `packages/core/src/modules/dictionaries/api/[dictionaryId]/route.ts` | PUT/DELETE | Updates/deletes dictionaries |
| 13 | `packages/core/src/modules/attachments/api/partitions/route.ts` | POST/PUT/DELETE | CRUD on `AttachmentPartition` |
| 14 | `packages/core/src/modules/currencies/api/fetch-rates/route.ts` | POST | Updates `CurrencyFetchConfig` in loop + single `em.flush()` |

#### LOW (UI preferences)

| # | File | Operation | What it does |
|---|------|-----------|-------------|
| 15 | `packages/core/src/modules/auth/api/sidebar/preferences/route.ts` | PUT | Saves sidebar layout preferences via `em.nativeDelete()` + helpers |

## Risk Analysis: What Can Go Wrong

### Risk 1: Transaction + Identity Map Interaction
**Severity: HIGH** — `em.transactional()` forks the EntityManager. Entities loaded BEFORE the transaction are tracked by the outer EM, not the transactional fork. If phases close over entities loaded outside the transaction, the flush inside the transaction may not see them.

**Mitigation**: Document that `withAtomicFlush` must be called AFTER the entity is loaded, or entities must be loaded inside Phase 1. The entity loaded on the outer EM is shared with the transactional fork's identity map, so mutations are visible — but this requires the entity to be tracked by the same EM that starts the transaction.

### Risk 2: em.transactional() + PostgreSQL Savepoints
**Severity: MEDIUM** — MikroORM's `em.transactional()` uses savepoints when nested. If `withAtomicFlush` is called inside a command that's already inside a transaction (e.g., the staff leave-requests command), it creates nested savepoints. This is safe in PostgreSQL but adds overhead.

**Mitigation**: The `transaction` option defaults to `false` to avoid unnecessary nesting. Only enable when atomicity is explicitly needed.

### Risk 3: Side Effects Emitted Before Transaction Commits
**Severity: MEDIUM** — If `emitCrudSideEffects()` / `markOrmEntityChange()` is called inside a phase that later rolls back, the side effect markers are still queued in the DataEngine. The CommandBus will emit events for entities that don't exist.

**Mitigation**: Side effects (`markOrmEntityChange`) should be called AFTER `withAtomicFlush` completes, not inside phases. This is already the pattern in most commands. Document this requirement explicitly.

### Risk 4: Performance Impact of Transactions
**Severity: LOW** — Wrapping multi-flush operations in a transaction holds a database connection and locks for longer. For simple 2-phase operations (scalar + tags), this is negligible. For complex restore operations (sales order graphs), the lock duration is already long.

**Mitigation**: Default `transaction: false`. Enable selectively for operations where atomicity matters more than throughput.

### Risk 5: Breaking Existing Tests
**Severity: LOW** — The migration is a refactor. Each command should retain its existing tests. The helper changes HOW flushes happen, not WHAT is flushed.

**Mitigation**: Run full test suite after each migration. The `withAtomicFlush2` convenience function makes the migration mechanical.

### Risk 6: Non-Command Routes Missing DI Container
**Severity: MEDIUM** — Some non-command API routes (e.g., attachment partitions) resolve `em` directly without a DI container, making it harder to inject the DataEngine and CommandBus.

**Mitigation**: Phase 2 migration (non-command to command) is a separate effort. Use `createRequestContainer()` to get the DI container, then dispatch through CommandBus.

## Alternatives Considered

### A. MikroORM `flushMode: FlushMode.AUTO`

Auto-flush before every query would theoretically prevent stale UoW state. **Rejected** because the current bug is specifically that auto-flush + subscriber logic resets `__originalEntityData` without issuing the UPDATE. Enabling auto-flush globally would make the problem worse, not better.

### B. Fix the MikroORM subscriber

Patching the subscriber to not reset `__originalEntityData` during auto-flush would fix the root cause at the ORM level. **Deferred** — we don't control MikroORM internals and the phased helper is valuable regardless (cleaner code, self-documenting).

### C. Phased `CommandHandler` type

Splitting `execute` into `applyChanges` / `syncRelations` / `afterCommit` phases with framework-managed flushes between them. **Deferred** — huge migration surface (47+ command files), two styles coexisting during migration adds confusion. `withAtomicFlush` achieves the same safety with minimal disruption and can be adopted incrementally.

### D. `createUndoRestorer` factory

A structured factory that enforces phases for undo handlers. **Deferred** — while the pattern is sound, `withAtomicFlush` solves the immediate problem with less abstraction. Can be revisited if undo handler boilerplate becomes a separate pain point.

### E. ESLint rule / static analysis

A custom lint rule that detects `em.find*()` calls after property assignments without an intervening `await em.flush()`. **Complementary** — could be added later but hard to make reliable (cross-function analysis, async control flow). Not a substitute for the runtime helper.

### F. Wrap CommandBus.execute() in transaction

Making CommandBus itself transactional (wrapping the entire `handler.execute()` call in `em.transactional()`). **Rejected** — too coarse-grained. Not all commands need transactions. Side effects (DataEngine markers) are designed to be emitted after the DB commit, not inside a transaction. Would require rethinking the entire side-effect architecture.

## Implementation Plan

### Step 1: Create the helper

1. Create `packages/shared/src/lib/commands/flush.ts` with `withAtomicFlush` and `withAtomicFlush2`
2. Re-export from `packages/shared/src/lib/commands/index.ts`
3. Add unit tests in `packages/shared/src/lib/commands/__tests__/flush.test.ts`

### Step 2: Migrate the 14 patched locations (Phase 1)

Refactor all 14 locations from the "Already manually patched" table above to use `withAtomicFlush`. Each is a direct replacement of the raw two-flush pattern. Enable `transaction: true` for all of them.

**Migration checklist per location:**
1. Import `withAtomicFlush` (or `withAtomicFlush2`)
2. Identify the flush boundary (where the manual `em.flush()` splits scalars from queries)
3. Wrap in `withAtomicFlush(em, [phase1, phase2], { transaction: true })`
4. Remove manual `em.flush()` calls inside the phases
5. Keep `emitCrudSideEffects` / `emitCrudUndoSideEffects` OUTSIDE `withAtomicFlush`
6. Run existing tests to verify behavior unchanged

### Step 3: Update AGENTS.md

Add the `withAtomicFlush` convention to the framework documentation (see dedicated section below).

### Step 4: Migrate non-command API routes (Phase 2 — separate PRs)

Each non-command route from the Phase 2 table above should be migrated to use a registered command. Priority order:

1. **CRITICAL**: Auth ACL routes (roles/acl, users/acl)
2. **HIGH**: Sales quote routes (accept, send)
3. **HIGH**: Dashboard widget routes (roles/widgets, users/widgets)
4. **MEDIUM**: Remaining routes (one PR per module)

Each migration creates:
- A new command handler (`registerCommand(...)`)
- Route updated to dispatch via `CommandBus`
- `withAtomicFlush` used inside the command for flush safety
- Audit logging and undo support where applicable

## Testing Strategy

### Unit tests for `withAtomicFlush`

```typescript
describe('withAtomicFlush', () => {
  it('flushes after each phase', async () => {
    const flushSpy = jest.spyOn(em, 'flush')
    const order: string[] = []

    await withAtomicFlush(em, [
      () => { entity.name = 'changed'; order.push('phase1') },
      async () => { await em.find(Tag, {}); order.push('phase2') },
      () => { entity.status = 'active'; order.push('phase3') },
    ])

    expect(flushSpy).toHaveBeenCalledTimes(3)
    expect(order).toEqual(['phase1', 'phase2', 'phase3'])
  })

  it('handles single phase', async () => {
    const flushSpy = jest.spyOn(em, 'flush')
    await withAtomicFlush(em, [() => { entity.name = 'changed' }])
    expect(flushSpy).toHaveBeenCalledTimes(1)
  })

  it('handles empty phases array', async () => {
    const flushSpy = jest.spyOn(em, 'flush')
    await withAtomicFlush(em, [])
    expect(flushSpy).not.toHaveBeenCalled()
  })

  it('wraps in transaction when option is set', async () => {
    const transactionalSpy = jest.spyOn(em, 'transactional')
    await withAtomicFlush(em, [
      () => { entity.name = 'changed' },
    ], { transaction: true })
    expect(transactionalSpy).toHaveBeenCalledTimes(1)
  })

  it('rolls back all phases on error in transaction mode', async () => {
    const error = new Error('Phase 2 failed')
    await expect(
      withAtomicFlush(em, [
        () => { entity.name = 'changed' },
        () => { throw error },
      ], { transaction: true })
    ).rejects.toThrow('Phase 2 failed')
    // In transaction mode, phase 1 changes are rolled back
  })

  it('does not roll back earlier phases without transaction', async () => {
    const flushSpy = jest.spyOn(em, 'flush')
    const error = new Error('Phase 2 failed')

    await expect(
      withAtomicFlush(em, [
        () => { entity.name = 'changed' },
        () => { throw error },
      ])
    ).rejects.toThrow('Phase 2 failed')
    // Without transaction, phase 1 was already flushed (committed)
    expect(flushSpy).toHaveBeenCalledTimes(1)
  })
})

describe('withAtomicFlush2', () => {
  it('skips second flush when syncRelations is omitted', async () => {
    const flushSpy = jest.spyOn(em, 'flush')
    await withAtomicFlush2(em, () => { entity.name = 'changed' })
    expect(flushSpy).toHaveBeenCalledTimes(1)
  })
})
```

### Integration tests

Each migrated command should retain its existing undo tests. The migration is a refactor — behavior must not change.

## AGENTS.md Documentation Update

The following section should be added to `AGENTS.md` under **Conventions**:

```markdown
## Entity Update Safety — `withAtomicFlush`

MikroORM's identity-map and subscriber infrastructure can silently discard pending scalar changes when a query (`em.find`, `em.findOne`, etc.) runs on the same `EntityManager` before an explicit `em.flush()`. Additionally, multiple `em.flush()` calls without transaction wrapping risk partial commits. See [SPEC-018](.ai/specs/SPEC-018-2026-02-05-safe-entity-flush.md) for the full analysis.

### Rules

- Use `withAtomicFlush(em, phases, options)` from
  `@open-mercato/shared/lib/commands/flush` when a command mutates
  entities across multiple phases that include queries on the same `EntityManager`.
- **NEVER** run `em.find` / `em.findOne` / sync helpers between scalar
  mutations and `em.flush()` on the same `EntityManager` without using `withAtomicFlush`.
- Enable `{ transaction: true }` when atomicity matters (all-or-nothing semantics).
- Keep `emitCrudSideEffects` / `emitCrudUndoSideEffects` calls **OUTSIDE** `withAtomicFlush`
  — side effects should only fire after the DB changes are committed.
- This applies to **both** `execute` methods (update commands) and `undo` handlers.

### Wrong

\```typescript
// BUG: changes to `record` are silently lost
record.name = 'New Name'
record.status = 'active'
await syncEntityTags(em, record, tags)   // internal em.find() resets UoW tracking
await em.flush()                          // no UPDATE issued
\```

### Correct

\```typescript
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'

await withAtomicFlush(em, [
  () => {
    record.name = 'New Name'
    record.status = 'active'
  },
  () => syncEntityTags(em, record, tags),
], { transaction: true })

// Side effects AFTER the atomic flush
await emitCrudSideEffects({ ... })
\```
```

## Changelog

### 2026-02-07
- **Major revision**: Renamed from `withEntityFlush` to `withAtomicFlush`
- Generalized from 2-phase (scalars/relations) to N-phase pipeline
- Added optional `transaction: true` mode for full atomicity
- Added `withAtomicFlush2` convenience overload for backward compatibility
- Added structured error handling design
- Full audit of 18 non-command API routes (Phase 2 migration targets)
- Risk analysis section with 6 identified risks and mitigations
- Separated implementation into Phase 1 (command migration) and Phase 2 (non-command migration)
- Updated AGENTS.md documentation section

### 2026-02-05
- Initial specification
- Defined `withEntityFlush` helper (now superseded by `withAtomicFlush`)
- Full audit of all 47 command files with undo handlers
- Catalogued 14 locations requiring migration
