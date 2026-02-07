# SPEC-018: Safe Entity Flush — Preventing Silent UoW Data Loss

## Overview

MikroORM's identity-map and subscriber infrastructure can silently discard pending scalar changes when a query (`em.find`, `em.findOne`, etc.) runs on the same `EntityManager` before an explicit `em.flush()`. This spec defines a framework-level helper so individual command handlers no longer need to remember the correct flush order.

## Problem Statement

### Root Cause

When an entity tracked by MikroORM's Unit of Work has dirty (unsaved) scalar fields, and a query is executed on the same `EntityManager`, the combination of auto-flush logic and subscriber hooks resets `__originalEntityData`. The subsequent explicit `em.flush()` then sees no changeset and issues no `UPDATE`.

```typescript
// BUG: changes to `record` are silently lost
record.name = 'New Name'
record.status = 'active'
await syncEntityTags(em, record, tags)   // ← internal em.find() resets UoW tracking
await em.flush()                          // ← no UPDATE issued
```

### The Fix Pattern

Always flush scalar field mutations **before** any query or sync helper that uses the same `EntityManager`:

```typescript
// CORRECT: flush boundary between scalars and queries
record.name = 'New Name'
record.status = 'active'
await em.flush()                          // ← scalar changes persisted
await syncEntityTags(em, record, tags)    // ← queries are safe now
await em.flush()                          // ← relation changes persisted
```

### Impact

- Affects **execute** methods (update commands) and **undo** handlers across all modules.
- The failure is **silent** — no error thrown, data simply doesn't persist.
- Every new command is at risk of re-introducing the bug because nothing enforces the boundary.

### Prior Art

The catalog `products.ts` fix (commit `792899ee`) first identified the pattern. Lesson recorded in `.ai/lessons.md` under "Flush entity updates before running relation syncs that query".

## Proposed Solution: `withEntityFlush`

A single utility in `packages/shared/src/lib/commands/flush.ts` that wraps the "apply scalars → flush → sync relations → flush" two-phase pattern.

```typescript
// packages/shared/src/lib/commands/flush.ts

import type { EntityManager } from '@mikro-orm/core'

/**
 * Apply scalar changes, flush, then optionally sync relations and flush again.
 *
 * Prevents the MikroORM identity-map bug where queries between scalar
 * mutations and flush silently discard the pending changeset.
 */
export async function withEntityFlush(
  em: EntityManager,
  applyScalars: () => void | Promise<void>,
  syncRelations?: () => void | Promise<void>,
): Promise<void> {
  await applyScalars()
  await em.flush()
  if (syncRelations) {
    await syncRelations()
    await em.flush()
  }
}
```

### Usage — execute method

```typescript
async execute(rawInput, ctx) {
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const record = await em.findOne(CustomerEntity, { id: parsed.id })

  await withEntityFlush(
    em,
    () => {
      record.displayName = parsed.displayName
      record.status = parsed.status
    },
    () => syncEntityTags(em, record, parsed.tags),
  )

  // custom fields, side effects ...
}
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

  await withEntityFlush(
    em,
    () => {
      entity.displayName = before.entity.displayName
      entity.status = before.entity.status
      // ... all scalar fields
    },
    async () => {
      const profile = await em.findOne(CustomerPersonProfile, { entity })
      if (profile) {
        profile.firstName = before.profile.firstName
        // ...
      }
      await syncEntityTags(em, entity, before.tagIds)
    },
  )
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

  await withEntityFlush(
    em,
    () => applyOrderSnapshot(order, snapshot.order),
    async () => {
      // queries for existing lines, nativeDelete, bulk create — all safe after flush
      const existingLines = await em.find(SalesOrderLine, { order: order.id })
      // ...
    },
  )
}
```

## File Layout

```
packages/shared/src/lib/commands/
├── flush.ts              # withEntityFlush helper (NEW)
├── undo.ts               # extractUndoPayload (existing)
├── index.ts              # re-exports (add flush.ts)
└── __tests__/
    └── flush.test.ts     # (NEW)
```

## Affected Locations — Full Audit

All locations where the manual two-flush pattern is needed. These are the places that must be migrated to `withEntityFlush`.

### Already manually patched (must migrate to helper)

These were fixed with raw `em.flush()` calls and should be refactored to use `withEntityFlush`:

| # | File | Handler | Pattern |
|---|------|---------|---------|
| 1 | `packages/core/src/modules/catalog/commands/products.ts` | execute (update) | Scalars → `syncOffers` / `syncCategoryAssignments` / `syncProductTags` |
| 2 | `packages/core/src/modules/catalog/commands/products.ts` | undo (update) | `applyProductSnapshot` → `restoreOffersFromSnapshot` / `syncCategoryAssignments` / `syncProductTags` |
| 3 | `packages/core/src/modules/customers/commands/people.ts` | execute (update) | Entity + profile scalars → `syncEntityTags` |
| 4 | `packages/core/src/modules/customers/commands/people.ts` | undo (update) | Entity scalars → `findOne(CustomerPersonProfile)` → profile scalars → `syncEntityTags` |
| 5 | `packages/core/src/modules/customers/commands/companies.ts` | execute (update) | Entity + profile scalars → `syncEntityTags` |
| 6 | `packages/core/src/modules/customers/commands/companies.ts` | undo (update) | Entity scalars → `findOne(CustomerCompanyProfile)` → profile scalars → `syncEntityTags` |
| 7 | `packages/core/src/modules/sales/commands/documents.ts` | `restoreOrderGraph` | `applyOrderSnapshot` → `find(SalesOrderLine)` / `find(SalesOrderAdjustment)` |
| 8 | `packages/core/src/modules/sales/commands/documents.ts` | `restoreQuoteGraph` | `applyQuoteSnapshot` → `find(SalesQuoteLine)` / `find(SalesQuoteAdjustment)` |
| 9 | `packages/core/src/modules/sales/commands/documents.ts` | execute (updateOrder) | `applyDocumentUpdate` → `find(SalesOrderLine)` / `find(SalesOrderAdjustment)` |
| 10 | `packages/core/src/modules/sales/commands/documents.ts` | execute (updateQuote) | `applyDocumentUpdate` → `resolveStatusEntryIdByValue` / `find(SalesQuoteLine)` |
| 11 | `packages/core/src/modules/sales/commands/shipments.ts` | `restoreShipmentSnapshot` | Entity scalars → `find(SalesShipmentItem)` |
| 12 | `packages/core/src/modules/sales/commands/payments.ts` | `restorePaymentSnapshot` | Entity scalars → `setRecordCustomFields` / `find(SalesPaymentAllocation)` |
| 13 | `packages/core/src/modules/resources/commands/resources.ts` | execute (update) | Entity scalars → `syncResourcesResourceTags` |
| 14 | `packages/core/src/modules/resources/commands/resources.ts` | undo (update) | Entity scalars → `syncResourcesResourceTags` |

### Already correct (no change needed, already flush before syncs)

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

### Safe — no relation syncs or queries between scalars and flush

All other command files were audited and confirmed safe. They either:
- Set scalar fields then immediately `em.flush()` with no queries in between
- Only create/delete entities (no update-then-query pattern)
- Use `em.nativeDelete` / `em.nativeUpdate` which bypasses the identity map

Modules confirmed safe: catalog (categories, offers, optionSchemas, priceKinds, prices, variants), currencies, dictionaries, feature_toggles, planner (all availability commands), resources (resource-types, tag-assignments, activities, comments), sales (configuration, notes, tags, statuses), staff (all commands), customers (todos, dictionaries, tags, activities, addresses, comments).

## Alternatives Considered

### A. MikroORM `flushMode: FlushMode.AUTO`

Auto-flush before every query would theoretically prevent stale UoW state. **Rejected** because the current bug is specifically that auto-flush + subscriber logic resets `__originalEntityData` without issuing the UPDATE. Enabling auto-flush globally would make the problem worse, not better.

### B. Fix the MikroORM subscriber

Patching the subscriber to not reset `__originalEntityData` during auto-flush would fix the root cause at the ORM level. **Deferred** — we don't control MikroORM internals and the phased helper is valuable regardless (cleaner code, self-documenting).

### C. Phased `CommandHandler` type

Splitting `execute` into `applyChanges` / `syncRelations` / `afterCommit` phases with framework-managed flushes between them. **Deferred** — huge migration surface (47+ command files), two styles coexisting during migration adds confusion. `withEntityFlush` achieves the same safety with minimal disruption.

### D. `createUndoRestorer` factory

A structured factory that enforces phases for undo handlers. **Deferred** — while the pattern is sound, `withEntityFlush` solves the immediate problem with less abstraction. Can be revisited if undo handler boilerplate becomes a separate pain point.

### E. ESLint rule / static analysis

A custom lint rule that detects `em.find*()` calls after property assignments without an intervening `await em.flush()`. **Complementary** — could be added later but hard to make reliable (cross-function analysis, async control flow). Not a substitute for the runtime helper.

## Implementation Plan

### Step 1: Create the helper

1. Create `packages/shared/src/lib/commands/flush.ts` with `withEntityFlush`
2. Re-export from `packages/shared/src/lib/commands/index.ts`
3. Add unit tests in `packages/shared/src/lib/commands/__tests__/flush.test.ts`

### Step 2: Migrate the 14 patched locations

Refactor all 14 locations from the "Already manually patched" table above to use `withEntityFlush`. Each is a direct replacement of the raw two-flush pattern.

### Step 3: Update AGENTS.md

Add the following section to the **Conventions** section of `AGENTS.md`:

```markdown
## Entity Update Safety (UoW Flush Order)

MikroORM's identity-map and subscriber infrastructure can silently discard pending scalar changes when a query (`em.find`, `em.findOne`, etc.) runs on the same `EntityManager` before an explicit `em.flush()`. See [SPEC-018](.ai/specs/SPEC-018-2026-02-05-safe-entity-flush.md) for the full analysis.

### Rules

- Use `withEntityFlush(em, applyScalars, syncRelations)` from
  `@open-mercato/shared/lib/commands/flush` when a command mutates
  scalar fields and then runs relation syncs or queries on the same `EntityManager`.
- **NEVER** run `em.find` / `em.findOne` / sync helpers (e.g., `syncEntityTags`,
  `syncCategoryAssignments`, `syncResourcesResourceTags`) between scalar
  mutations and `em.flush()` on the same `EntityManager`.
- This applies to **both** `execute` methods (update commands) and `undo` handlers.

### Wrong

‍```typescript
// BUG: changes to `record` are silently lost
record.name = 'New Name'
record.status = 'active'
await syncEntityTags(em, record, tags)   // ← internal em.find() resets UoW tracking
await em.flush()                          // ← no UPDATE issued
‍```

### Correct

‍```typescript
import { withEntityFlush } from '@open-mercato/shared/lib/commands/flush'

await withEntityFlush(
  em,
  () => {
    record.name = 'New Name'
    record.status = 'active'
  },
  () => syncEntityTags(em, record, tags),
)
‍```
```

## Testing Strategy

### Unit tests for `withEntityFlush`

```typescript
it('flushes after scalars before running syncRelations', async () => {
  const flushSpy = jest.spyOn(em, 'flush')
  const order: string[] = []

  await withEntityFlush(
    em,
    () => { entity.name = 'changed'; order.push('scalars') },
    async () => { await em.find(Tag, {}); order.push('sync') },
  )

  expect(flushSpy).toHaveBeenCalledTimes(2)
  expect(order).toEqual(['scalars', 'sync'])
})

it('skips second flush when syncRelations is omitted', async () => {
  const flushSpy = jest.spyOn(em, 'flush')
  await withEntityFlush(em, () => { entity.name = 'changed' })
  expect(flushSpy).toHaveBeenCalledTimes(1)
})
```

### Integration tests

Each migrated command should retain its existing undo tests. The migration is a refactor — behavior must not change.

## Changelog

### 2026-02-05
- Initial specification
- Defined `withEntityFlush` helper
- Full audit of all 47 command files with undo handlers
- Catalogued 14 locations requiring migration
