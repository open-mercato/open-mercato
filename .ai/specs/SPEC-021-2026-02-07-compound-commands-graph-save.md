# SPEC-021: Compound Commands & Graph Save Pattern

## Overview

This spec introduces a **Graph Save** command pattern for aggregate roots (sales orders, quotes, customers) that allows submitting parent + calculation-coupled children in a single atomic operation. It also introduces a lightweight **Compound Command** wrapper for independent commands that must share a single undo entry (e.g., shipment + shipping-cost adjustment).

The existing per-child commands (`sales.orders.lines.upsert`, etc.) are **preserved** for inline editing and integration use cases. The graph-save command is an additional path optimized for form-based saves.

## Problem Statement

### Problem 1: N Snapshots, N Recalculations, N Undo Entries for One "Save"

When a user edits a sales order form (header + 3 lines + 1 adjustment), the frontend fires **5 independent HTTP requests**, each triggering:

1. `loadOrderSnapshot` (loads entire order + ALL children + ALL custom fields)
2. `salesCalculationService.calculateDocumentTotals()` (recalculates ALL lines + adjustments)
3. A separate audit log / undo entry

**Impact:**
- `loadOrderSnapshot` is called **14 times** across order commands in `documents.ts`
- `loadQuoteSnapshot` is called **15 times** across quote commands
- A 100-line order that adds 1 line loads all 100 lines + all adjustments + addresses + notes + tags + shipments + payments + custom fields
- The user sees 5 undo entries for a single "save" action and must undo each separately
- Intermediate calculation states are inconsistent (line 2 recalculates before line 3 is added)

### Problem 2: Calculation Coupling Makes Separate Commands Wasteful

Lines and adjustments are a **single calculation unit**. The `salesCalculationService.calculateDocumentTotals()` takes ALL lines + ALL adjustments together because:

- Adjustments can be percentage-based (depend on subtotals from all lines)
- Tax calculations may span multiple lines
- Discount strategies may cross-reference line totals

When you upsert 3 lines separately, you recalculate the entire document 3 times. Only the last calculation produces the correct result.

### Problem 3: Shipment + Adjustment Is Two Commands, One Intent

When a user creates a shipment and checks "Add shipping cost adjustment", the UI fires two commands (`sales.shipments.create` + `sales.orders.adjustments.upsert`). If the adjustment fails, the shipment is already committed. The user sees two undo entries for one action.

### Problem 4: No API for Bulk Line Submission

Integrations that need to create an order with 50 lines must call `POST /api/sales/order-lines` 50 times, each triggering a full document recalculation. There is no batch endpoint.

## Proposed Solution

Two complementary patterns:

### Pattern A: Graph Save Command

A single command that accepts the parent + all calculation-coupled children in one payload. Recalculates once. One snapshot. One undo entry.

### Pattern B: Compound Command Wrapper

A lightweight wrapper that groups 2+ independent commands into a single audit log entry with a single undo token. Each sub-command executes independently but they share undo semantics.

## Design Decisions

### Why Graph Save Instead of Compounding Existing Commands?

**Compounding** would mean: run `sales.orders.update` + `sales.orders.lines.upsert` + `sales.orders.lines.upsert` as a sequence, then merge their undo entries.

This is worse than graph save for calculation-coupled children because:

| Concern | Compound (sequence of existing commands) | Graph Save (single command) |
|---------|----------------------------------------|----------------------------|
| Snapshots | N snapshots (one per sub-command) | 1 snapshot |
| Recalculations | N recalculations | 1 recalculation (on final state) |
| Intermediate states | Inconsistent (line 2 recalced without line 3) | None — final state only |
| Transaction | Must wrap N flushes in one transaction | Single `withAtomicFlush` |
| Undo restore | Must restore N sub-snapshots in reverse order | Restore one graph snapshot |
| Code complexity | Orchestration layer + existing commands | Self-contained handler |

**The calculation coupling is the deciding factor.** If children are calculation-independent, compounding works fine (see Pattern B). If they're coupled, you want a single execute that builds the final state and calculates once.

### Why Keep Existing Line/Adjustment Commands?

The existing `sales.orders.lines.upsert` and `sales.orders.lines.delete` commands serve valid use cases that the graph-save command should **not** replace:

1. **Inline editing** — user edits a single cell in a line data table row. Submitting the entire order graph for a quantity change is overkill.
2. **Integrations** — external systems (ERP sync, API consumers) may add/update individual lines programmatically.
3. **Granular undo** — sometimes the user wants to undo just one line change, not the entire form save.
4. **Backward compatibility** — existing frontend code, tests, and integrations depend on these endpoints.

The graph-save command is the preferred path for **form-based saves** where the user edits multiple things and clicks one "Save" button.

### Which Children Are Inline vs. Separate?

Based on calculation coupling analysis and UI interaction patterns:

| Child | Calculation-coupled? | Edited in order form? | Pattern |
|-------|---------------------|----------------------|---------|
| **Lines** | YES (recalcs all lines + adjustments) | YES | **Inline** in graph save |
| **Adjustments** | YES (recalcs all lines + adjustments) | YES | **Inline** in graph save |
| **Addresses** | NO | YES (in form) | **Inline** in graph save (data-only) |
| **Tags** | NO | YES (in form) | **Inline** in graph save (data-only) |
| **Custom fields** | NO | YES (in form) | **Inline** in graph save |
| **Notes** | NO | NO (separate action) | **Separate** command |
| **Payments** | Partial (updates order totals) | NO (separate dialog) | **Separate** command |
| **Shipments** | Partial (updates fulfilled qty) | NO (separate dialog) | **Separate** command |

## Pattern A: Graph Save Command

### API Contract

#### Input Schema

```typescript
// packages/core/src/modules/sales/data/validators.ts

export const orderGraphSaveSchema = z.object({
  id: z.string().uuid(),

  /** Order header fields — partial, only send what changed */
  header: documentUpdateSchema.omit({ id: true }).partial().optional(),

  /** Line operations — upsert creates or updates, delete removes by ID */
  lines: z.object({
    upsert: z.array(orderLineCreateSchema.extend({
      id: z.string().uuid().optional(),
    })).optional(),
    delete: z.array(z.string().uuid()).optional(),
  }).optional(),

  /** Adjustment operations */
  adjustments: z.object({
    upsert: z.array(orderAdjustmentCreateSchema.extend({
      id: z.string().uuid().optional(),
    })).optional(),
    delete: z.array(z.string().uuid()).optional(),
  }).optional(),

  /** Address operations */
  addresses: z.object({
    upsert: z.array(documentAddressSchema.extend({
      id: z.string().uuid().optional(),
    })).optional(),
    delete: z.array(z.string().uuid()).optional(),
  }).optional(),

  /** Tag IDs — full replacement (not diff-based) */
  tags: z.array(z.string().uuid()).optional(),

  /** Custom fields for the order itself */
  customFields: z.record(z.string(), z.unknown()).optional(),
})

export type OrderGraphSaveInput = z.infer<typeof orderGraphSaveSchema>
```

The same pattern applies to quotes:

```typescript
export const quoteGraphSaveSchema = z.object({
  id: z.string().uuid(),
  header: documentUpdateSchema.omit({ id: true }).partial().optional(),
  lines: z.object({
    upsert: z.array(quoteLineCreateSchema.extend({ id: z.string().uuid().optional() })).optional(),
    delete: z.array(z.string().uuid()).optional(),
  }).optional(),
  adjustments: z.object({
    upsert: z.array(quoteAdjustmentCreateSchema.extend({ id: z.string().uuid().optional() })).optional(),
    delete: z.array(z.string().uuid()).optional(),
  }).optional(),
  addresses: z.object({
    upsert: z.array(documentAddressSchema.extend({ id: z.string().uuid().optional() })).optional(),
    delete: z.array(z.string().uuid()).optional(),
  }).optional(),
  tags: z.array(z.string().uuid()).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
})
```

#### API Endpoint

```
PUT /api/sales/orders/:id/save   →  sales.orders.save
PUT /api/sales/quotes/:id/save   →  sales.quotes.save
```

These are **new routes** alongside the existing CRUD routes. The existing `PUT /api/sales/orders` (header-only update) and `POST /api/sales/order-lines` (individual line upsert) continue to work.

### Command Handler

```typescript
// packages/core/src/modules/sales/commands/documents.ts

const orderSaveCommand: CommandHandler<OrderGraphSaveInput, { order: SalesOrder }> = {
  id: 'sales.orders.save',
  isUndoable: true,

  async prepare(rawInput, ctx) {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const input = orderGraphSaveSchema.parse(rawInput)
    const snapshot = await loadOrderSnapshot(em, input.id)
    return snapshot ? { before: snapshot } : {}
  },

  async execute(rawInput, ctx) {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const salesCalculationService = ctx.container.resolve('salesCalculationService')
    const input = orderGraphSaveSchema.parse(rawInput)

    const order = await findOneWithDecryption(em, SalesOrder, {
      id: input.id,
      deletedAt: null,
    })
    if (!order) throw new CrudHttpError(404, { error: 'Sales order not found' })

    await withAtomicFlush(em, [
      // Phase 1: Apply header scalar mutations
      () => {
        if (input.header) {
          applyDocumentUpdate({ kind: 'order', entity: order, input: input.header, em })
        }
      },

      // Phase 2: Sync data-only children (addresses, tags)
      async () => {
        if (input.addresses) {
          await syncDocumentAddresses(em, order.id, 'order', input.addresses)
        }
        if (input.tags !== undefined) {
          await syncDocumentTags(em, order.id, 'order', input.tags)
        }
      },

      // Phase 3: Build final line + adjustment state, recalculate ONCE
      async () => {
        const existingLines = await em.find(SalesOrderLine, { order },
          { orderBy: { lineNumber: 'asc' } })
        const existingAdjustments = await em.find(SalesOrderAdjustment, { order },
          { orderBy: { position: 'asc' } })

        // Merge upserts and deletes into final sets
        const nextLines = mergeChildChanges(existingLines, input.lines)
        const nextAdjustments = mergeChildChanges(existingAdjustments, input.adjustments)

        // Recalculate once on the final state
        const calculation = await salesCalculationService.calculateDocumentTotals({
          documentKind: 'order',
          lines: toCalcLines(nextLines),
          adjustments: toAdjustmentDrafts(nextAdjustments),
          context: buildCalculationContext(order, ctx),
          existingTotals: resolveExistingPaymentTotals(order),
        })

        // Persist all line/adjustment results
        await applyOrderLineResults({ em, order, calculation, sourceLines: nextLines, existingLines })
        await replaceOrderAdjustments({ em, order, calculation, existingAdjustments })
        applyOrderTotals(order, calculation.totals, calculation.lines.length)
      },

      // Phase 4: Custom fields
      async () => {
        if (input.customFields) {
          await setRecordCustomFields(em, {
            entityId: E.sales.sales_order,
            recordId: order.id,
            values: input.customFields,
            tenantId: order.tenantId,
            organizationId: order.organizationId,
          })
        }
        // Line-level custom fields from upserted lines
        for (const lineInput of input.lines?.upsert ?? []) {
          if (lineInput.customFields && lineInput.id) {
            await setRecordCustomFields(em, {
              entityId: E.sales.sales_order_line,
              recordId: lineInput.id,
              values: lineInput.customFields,
              tenantId: order.tenantId,
              organizationId: order.organizationId,
            })
          }
        }
      },
    ], { transaction: true, label: 'sales.orders.save' })

    // Side effects OUTSIDE the atomic flush (per SPEC-018)
    await emitCrudSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: order,
      identifiers: { id: order.id, organizationId: order.organizationId, tenantId: order.tenantId },
      events: orderCrudEvents,
      indexer: orderCrudIndexer,
    })

    return { order }
  },

  async captureAfter(_input, result, ctx) {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadOrderSnapshot(em, result.order.id)
  },

  async buildLog({ input, result, snapshots, ctx }) {
    const { t } = await resolveTranslations()
    const before = snapshots?.before as OrderGraphSnapshot | null
    const after = snapshots?.after as OrderGraphSnapshot | null
    return {
      tenantId: result.order.tenantId,
      organizationId: result.order.organizationId,
      actorUserId: ctx.auth?.userId,
      actionLabel: t('sales.actions.saveOrder', 'Save order'),
      resourceKind: 'sales.orders',
      resourceId: result.order.id,
      snapshotBefore: before,
      snapshotAfter: after,
      context: { cacheAliases: ['sales.orders', 'sales.documents'] },
      payload: {
        undo: { before, after } satisfies OrderUndoPayload,
      },
    }
  },

  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<OrderUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await restoreOrderGraph(em, before)
    await emitCrudUndoSideEffects({
      dataEngine: ctx.container.resolve('dataEngine'),
      action: 'updated',
      entity: before.order,
      identifiers: {
        id: before.order.id,
        organizationId: before.order.organizationId,
        tenantId: before.order.tenantId,
      },
      indexer: orderCrudIndexer,
    })
  },
}

registerCommand(orderSaveCommand)
```

### Helper: `mergeChildChanges`

A reusable utility for applying upsert/delete operations to an existing entity set:

```typescript
// packages/shared/src/lib/commands/graph-save.ts

interface ChildChanges<T> {
  upsert?: T[]
  delete?: string[]
}

/**
 * Merges upsert/delete operations into an existing entity array.
 *
 * - Upsert with `id` that matches an existing entity: merge fields onto existing
 * - Upsert without `id`: treat as new (will be persisted in the apply phase)
 * - Delete: remove from the resulting set
 *
 * Returns the final set of entities/drafts to pass to the calculation service.
 */
export function mergeChildChanges<T extends { id: string }>(
  existing: T[],
  changes?: ChildChanges<Partial<T> & { id?: string }> | null,
): Array<T | (Partial<T> & { id?: string })> {
  if (!changes) return [...existing]

  const deleteSet = new Set(changes.delete ?? [])
  const upsertById = new Map(
    (changes.upsert ?? [])
      .filter((u): u is typeof u & { id: string } => !!u.id)
      .map((u) => [u.id, u]),
  )

  // Start with existing, apply updates, filter deletes
  const result: Array<T | (Partial<T> & { id?: string })> = existing
    .filter((e) => !deleteSet.has(e.id))
    .map((e) => {
      const update = upsertById.get(e.id)
      if (update) {
        upsertById.delete(e.id)
        return { ...e, ...update }
      }
      return e
    })

  // Add new entries (upserts without matching existing id)
  const newEntries = (changes.upsert ?? []).filter((u) => !u.id || !existing.some((e) => e.id === u.id))
  for (const remaining of upsertById.values()) {
    // Upsert with id that didn't match existing — treat as update of previously deleted
    result.push(remaining)
  }
  result.push(...newEntries)

  return result
}
```

### Helper: `syncDocumentAddresses`

Data-only sync for addresses (no calculation involvement):

```typescript
// packages/core/src/modules/sales/lib/document-helpers.ts

export async function syncDocumentAddresses(
  em: EntityManager,
  documentId: string,
  documentKind: 'order' | 'quote',
  changes: { upsert?: AddressInput[]; delete?: string[] },
): Promise<void> {
  // Delete
  if (changes.delete?.length) {
    await em.nativeDelete(SalesDocumentAddress, {
      id: { $in: changes.delete },
      documentId,
      documentKind,
    })
  }

  // Upsert
  for (const addr of changes.upsert ?? []) {
    if (addr.id) {
      const existing = await em.findOne(SalesDocumentAddress, { id: addr.id, documentId })
      if (existing) {
        Object.assign(existing, addr)
        continue
      }
    }
    em.create(SalesDocumentAddress, { ...addr, documentId, documentKind })
  }
}
```

### API Route

```typescript
// packages/core/src/modules/sales/api/orders/save/route.ts

import { makeCrudRoute } from '@open-mercato/shared/lib/api/crud'
import { orderGraphSaveSchema } from '../../../data/validators'

const route = makeCrudRoute({
  actions: {
    update: {
      commandId: 'sales.orders.save',
      schema: orderGraphSaveSchema,
    },
  },
  metadata: {
    requireAuth: true,
    requireFeatures: ['sales.edit'],
  },
  indexer: { entityType: E.sales.sales_order },
})

export const PUT = route.PUT
```

## Pattern B: Compound Command Wrapper

For grouping **calculation-independent** commands that represent a single user intent.

### Use Case: Shipment + Shipping Cost Adjustment

When the user creates a shipment and checks "Add shipping cost adjustment", the UI currently fires two separate API calls. With a compound command, they become one atomic operation:

```
User action: "Create shipment with shipping cost"
  → sales.shipments.create-with-cost (compound command)
    internally runs:
      1. sales.shipments.create({ ... })
      2. sales.orders.adjustments.upsert({ kind: 'shipping', ... })
  → ONE audit log entry
  → ONE undo (deletes shipment + deletes adjustment)
```

### Core Types

```typescript
// packages/shared/src/lib/commands/compound.ts

import type { CommandRuntimeContext } from './types'

/** A single step in a compound command — references an existing registered command */
interface CompoundStep {
  commandId: string
  input: unknown
}

/** Result from executing one step (captured for undo) */
interface CompoundStepResult {
  commandId: string
  input: unknown
  result: unknown
  /** Snapshots captured by the sub-command's prepare/captureAfter */
  snapshots: { before?: unknown; after?: unknown }
}

/** Stored in the compound command's undo payload */
interface CompoundUndoPayload {
  steps: CompoundStepResult[]
}
```

### The `createCompoundCommand` Factory

A compound command is a **real `CommandHandler`** — it has an `id`, gets registered in the command registry, flows through `CommandBus` with full audit log and undo support. The factory creates one from a list of steps:

```typescript
// packages/shared/src/lib/commands/compound.ts

import { commandRegistry } from './registry'
import type { CommandHandler, CommandRuntimeContext } from './types'

interface CompoundCommandConfig<TInput = unknown> {
  /** Unique command ID, e.g. 'sales.shipments.create-with-cost' */
  id: string

  /**
   * Given the compound command's input, return the ordered list of steps.
   * Each step references an existing registered command.
   *
   * This is a function (not a static array) because the steps and their
   * inputs typically depend on the compound command's input.
   */
  buildSteps: (input: TInput, ctx: CommandRuntimeContext) => CompoundStep[] | Promise<CompoundStep[]>

  /** Resource kind for the audit log (e.g., 'sales.shipments') */
  resourceKind: string

  /** Extract the primary resource ID from step results (for the audit log) */
  resolveResourceId?: (stepResults: unknown[]) => string | null

  /** Human-readable action label (or function that receives ctx for i18n) */
  actionLabel: string | ((ctx: CommandRuntimeContext) => string | Promise<string>)
}

/**
 * Creates a CommandHandler that executes multiple sub-commands as a single
 * atomic operation with one audit log entry and one undo token.
 *
 * Each sub-command runs its own prepare → execute → captureAfter cycle.
 * The compound command captures all step snapshots for undo.
 * On undo, sub-commands are undone in REVERSE order.
 *
 * The entire operation runs inside a database transaction via withAtomicFlush.
 *
 * Use this for commands that are NOT calculation-coupled but represent
 * a single user intent. For calculation-coupled children, use graph-save instead.
 */
export function createCompoundCommand<TInput = unknown>(
  config: CompoundCommandConfig<TInput>,
): CommandHandler<TInput, { results: unknown[] }> {
  return {
    id: config.id,
    isUndoable: true,

    async execute(input, ctx) {
      const steps = await config.buildSteps(input as TInput, ctx)
      const stepResults: CompoundStepResult[] = []

      await withAtomicFlush(
        (ctx.container.resolve('em') as EntityManager).fork(),
        steps.map((step) => async () => {
          // Resolve the sub-command handler
          const handler = commandRegistry.get(step.commandId)
          if (!handler) {
            throw new Error(`Compound step: command "${step.commandId}" not found`)
          }

          // Run the sub-command's full lifecycle manually
          const snapshots: { before?: unknown; after?: unknown } = {}

          // 1. Prepare (capture before-state)
          if (handler.prepare) {
            const prepared = await handler.prepare(step.input, ctx)
            snapshots.before = prepared?.before
          }

          // 2. Execute
          const result = await handler.execute(step.input, ctx)

          // 3. Capture after-state
          if (handler.captureAfter) {
            snapshots.after = await handler.captureAfter(step.input, result, ctx)
          }

          stepResults.push({
            commandId: step.commandId,
            input: step.input,
            result,
            snapshots,
          })
        }),
        { transaction: true, label: config.id },
      )

      // Side effects for all steps — emitted AFTER the transaction commits
      for (const step of stepResults) {
        const handler = commandRegistry.get(step.commandId)
        // Sub-commands emit their own side effects inside execute(),
        // which is already called above. Nothing extra needed here.
      }

      return { results: stepResults.map((s) => s.result) }
    },

    async buildLog({ input, result, ctx }) {
      const stepResults = (result as { results: unknown[] }).results
      const actionLabel = typeof config.actionLabel === 'function'
        ? await config.actionLabel(ctx)
        : config.actionLabel

      return {
        tenantId: ctx.auth?.tenantId,
        organizationId: ctx.selectedOrganizationId,
        actorUserId: ctx.auth?.userId,
        actionLabel,
        resourceKind: config.resourceKind,
        resourceId: config.resolveResourceId?.(stepResults) ?? null,
        payload: {
          undo: {
            steps: stepResults,
          } satisfies CompoundUndoPayload,
        },
      }
    },

    async undo({ logEntry, ctx }) {
      const payload = extractUndoPayload<CompoundUndoPayload>(logEntry)
      if (!payload?.steps?.length) return

      // Undo in REVERSE order
      for (const step of [...payload.steps].reverse()) {
        const handler = commandRegistry.get(step.commandId)
        if (!handler?.undo) continue

        // Build a synthetic log entry for the sub-command's undo handler
        // so it can extract its own before/after snapshots
        await handler.undo({
          input: step.input,
          ctx,
          logEntry: {
            ...logEntry,
            resourceId: typeof step.result === 'object' && step.result !== null
              ? (step.result as Record<string, unknown>).id as string ?? logEntry.resourceId
              : logEntry.resourceId,
            commandPayload: {
              undo: {
                before: step.snapshots.before,
                after: step.snapshots.after,
              },
            },
          },
        })
      }
    },
  }
}
```

### Concrete Example: Shipment with Shipping Cost

This is what a real compound command declaration looks like — short, declarative, and fully typed:

```typescript
// packages/core/src/modules/sales/commands/shipments.ts

import { createCompoundCommand } from '@open-mercato/shared/lib/commands/compound'
import { registerCommand } from '@open-mercato/shared/lib/commands'

// --- Input schema ---

const createShipmentWithCostSchema = z.object({
  // Shipment fields
  orderId: z.string().uuid(),
  shipmentNumber: z.string().optional(),
  carrierName: z.string().optional(),
  trackingNumber: z.string().optional(),
  items: z.array(shipmentItemSchema),
  // Shipping cost adjustment fields
  shippingCostNet: decimal(),
  shippingCostGross: decimal().optional(),
  currencyCode: currencyCodeSchema,
  // Optional status changes
  documentStatusEntryId: z.string().uuid().optional(),
})

type CreateShipmentWithCostInput = z.infer<typeof createShipmentWithCostSchema>

// --- Compound command ---

const createShipmentWithCostCommand = createCompoundCommand<CreateShipmentWithCostInput>({
  id: 'sales.shipments.create-with-cost',
  resourceKind: 'sales.shipments',
  actionLabel: 'Create shipment with shipping cost',

  buildSteps(input) {
    return [
      {
        commandId: 'sales.shipments.create',
        input: {
          orderId: input.orderId,
          shipmentNumber: input.shipmentNumber,
          carrierName: input.carrierName,
          trackingNumber: input.trackingNumber,
          items: input.items,
          documentStatusEntryId: input.documentStatusEntryId,
        },
      },
      {
        commandId: 'sales.orders.adjustments.upsert',
        input: {
          body: {
            orderId: input.orderId,
            kind: 'shipping',
            label: 'Shipping cost',
            amountNet: input.shippingCostNet,
            amountGross: input.shippingCostGross,
            currencyCode: input.currencyCode,
          },
        },
      },
    ]
  },

  resolveResourceId(stepResults) {
    // Primary resource is the shipment (first step result)
    const shipmentResult = stepResults[0] as { shipmentId?: string } | undefined
    return shipmentResult?.shipmentId ?? null
  },
})

registerCommand(createShipmentWithCostCommand)
```

### What Happens at Runtime

```
1. CommandBus.execute('sales.shipments.create-with-cost', input)

2. Compound handler.execute() runs:
   ┌─ withAtomicFlush (transaction: true) ──────────────────────┐
   │                                                             │
   │  Step 1: sales.shipments.create                            │
   │    ├─ prepare()    → captures shipment before-state (null) │
   │    ├─ execute()    → creates shipment + updates order       │
   │    ├─ captureAfter() → snapshots shipment after-state      │
   │    └─ flush                                                 │
   │                                                             │
   │  Step 2: sales.orders.adjustments.upsert                   │
   │    ├─ prepare()    → captures order graph before-state      │
   │    ├─ execute()    → creates adjustment + recalcs totals    │
   │    ├─ captureAfter() → snapshots order graph after-state   │
   │    └─ flush                                                 │
   │                                                             │
   └─ COMMIT (or ROLLBACK if any step fails) ───────────────────┘

3. Compound handler.buildLog() writes ONE audit log entry:
   {
     actionLabel: 'Create shipment with shipping cost',
     resourceKind: 'sales.shipments',
     resourceId: '<shipment-uuid>',
     payload: {
       undo: {
         steps: [
           { commandId: 'sales.shipments.create', snapshots: { before, after }, ... },
           { commandId: 'sales.orders.adjustments.upsert', snapshots: { before, after }, ... },
         ]
       }
     }
   }

4. User clicks UNDO:
   ┌─ Compound handler.undo() ─────────────────────────────────┐
   │                                                             │
   │  Step 2 undo (reverse order): adjustments.upsert.undo()   │
   │    → deletes adjustment, restores order totals              │
   │                                                             │
   │  Step 1 undo (reverse order): shipments.create.undo()      │
   │    → deletes shipment, restores fulfilled quantities        │
   │                                                             │
   └─────────────────────────────────────────────────────────────┘
```

### API Route for Compound Commands

Compound commands are registered commands — they get their own API routes:

```typescript
// packages/core/src/modules/sales/api/shipments/create-with-cost/route.ts

const route = makeCrudRoute({
  actions: {
    create: {
      commandId: 'sales.shipments.create-with-cost',
      schema: createShipmentWithCostSchema,
    },
  },
  metadata: {
    requireAuth: true,
    requireFeatures: ['sales.edit'],
  },
})

export const POST = route.POST
```

Or alternatively, the existing shipment route handler can conditionally dispatch the compound command:

```typescript
// packages/core/src/modules/sales/api/shipments/route.ts (existing, modified)

// In the POST handler:
if (input.addShippingAdjustment && input.shippingCostNet) {
  return commandBus.execute('sales.shipments.create-with-cost', input)
} else {
  return commandBus.execute('sales.shipments.create', shipmentPayload)
}
```

### Other Compound Command Candidates

The same `createCompoundCommand` factory applies to any "two actions, one intent" scenario:

```typescript
// Example: Payment + status change + comment
const createPaymentWithCommentCommand = createCompoundCommand({
  id: 'sales.payments.create-with-comment',
  resourceKind: 'sales.payments',
  actionLabel: 'Record payment with note',
  buildSteps(input) {
    const steps: CompoundStep[] = [
      { commandId: 'sales.payments.create', input: input.payment },
    ]
    if (input.comment) {
      steps.push({ commandId: 'sales.notes.create', input: input.comment })
    }
    return steps
  },
  resolveResourceId(results) {
    return (results[0] as { paymentId?: string })?.paymentId ?? null
  },
})
```

### Key Design Properties

1. **It's a real `CommandHandler`** — registered in the command registry, flows through `CommandBus`, gets an audit log entry, has an undo token. No special infrastructure needed.

2. **Sub-commands are reusable** — `sales.shipments.create` works standalone AND as a compound step. No code duplication.

3. **Sub-command undo handlers are reused** — the compound undo delegates to each sub-command's existing undo handler. No new undo logic needed.

4. **Transaction boundary** — all steps run inside `withAtomicFlush({ transaction: true })`. If step 2 fails, step 1 is rolled back.

5. **`buildSteps` is a function** — the steps and their inputs can depend on the compound input. Conditional steps (like "only add comment if provided") are natural.

6. **Snapshots are per-step** — each sub-command captures its own before/after snapshots via its existing `prepare`/`captureAfter` hooks. The compound command stores all of them for undo.

### When to Use Which Pattern

| Scenario | Pattern | Why |
|----------|---------|-----|
| Order form save (header + lines + adjustments) | **Graph Save** | Calculation-coupled; need single recalc |
| Shipment + shipping cost adjustment | **Compound** | Independent commands, single user intent |
| Inline edit one line in data table | **Existing command** (`lines.upsert`) | Granular operation, single entity |
| Integration adds 50 lines | **Graph Save** | Batch efficiency, single recalc |
| Payment creation | **Existing command** (`payments.create`) | Independent lifecycle, separate dialog |
| Note creation | **Existing command** (`notes.create`) | Independent action |

## Customer Module Application

The same graph-save pattern applies to customers, which already partially follow it:

### Current State

`customers.people.update` handles: entity + profile + tags + custom fields in one command.
But addresses, comments, activities, deals are separate commands with separate undo.

### Proposed: `customers.people.save`

```typescript
export const personGraphSaveSchema = z.object({
  id: z.string().uuid(),

  /** Person entity + profile fields — partial */
  header: personUpdateSchema.omit({ id: true }).partial().optional(),

  /** Address operations */
  addresses: z.object({
    upsert: z.array(customerAddressSchema.extend({ id: z.string().uuid().optional() })).optional(),
    delete: z.array(z.string().uuid()).optional(),
  }).optional(),

  /** Tag IDs — full replacement */
  tags: z.array(z.string().uuid()).optional(),

  /** Custom fields */
  customFields: z.record(z.string(), z.unknown()).optional(),
})
```

No calculation coupling exists for customers, so all children are data-only syncs. The benefit is purely UX: one undo entry for "save customer form".

Comments, activities, and deals remain separate commands — they represent distinct user actions (adding a comment is not "editing the customer").

## Interaction with SPEC-018 (`withAtomicFlush`)

All graph-save commands use `withAtomicFlush` from SPEC-018 internally:

1. **Phase separation**: Header scalars flushed before relation syncs (prevents UoW data loss)
2. **Transaction wrapping**: `{ transaction: true }` ensures all-or-nothing semantics
3. **Side effects outside**: `emitCrudSideEffects` called after `withAtomicFlush` completes (per SPEC-018 rules)

The compound command wrapper also uses transactions by default, wrapping all sub-command executions.

## CommandBus Changes

The `CommandBus` needs a minor extension to support compound commands:

### `skipLog` Option

```typescript
// packages/shared/src/lib/commands/command-bus.ts

interface ExecuteOptions {
  // ... existing options ...

  /** When true, suppress audit log creation. Used by compound wrapper. */
  skipLog?: boolean
}
```

When `skipLog` is true, the CommandBus:
- Still runs `prepare`, `execute`, `captureAfter`
- Still processes side effects
- Does NOT persist an `ActionLog` entry
- Returns the snapshots to the caller (so the compound wrapper can store them)

### Compound Log Schema

```typescript
// packages/shared/src/lib/commands/types.ts

interface CompoundStepLog {
  commandId: string
  input: unknown
  result: unknown
  resourceId?: string
  payload?: {
    undo?: unknown
  }
}

interface CompoundLogPayload {
  compound: {
    steps: CompoundStepLog[]
  }
}
```

The compound audit log entry uses `resourceKind: 'compound'` and stores all step data in `payload.compound.steps`. The undo handler recognizes this structure and delegates to sub-command undo handlers in reverse order.

## Migration Path

### Phase 1: Infrastructure (no behavior changes)

1. Create `packages/shared/src/lib/commands/graph-save.ts` with `mergeChildChanges` helper
2. Create `packages/shared/src/lib/commands/compound.ts` with `createCompoundCommand` factory
3. Add `skipLog` option to `CommandBus.execute()` (returns snapshots when suppressed)
4. Add `CompoundStepResult`, `CompoundUndoPayload` types
5. Unit tests for all helpers

### Phase 2: Sales Order Graph Save

1. Add `orderGraphSaveSchema` to `data/validators.ts`
2. Implement `sales.orders.save` command in `documents.ts`
3. Reuse existing `loadOrderSnapshot`, `restoreOrderGraph`, `applyOrderLineResults`, `applyOrderTotals`
4. Add `syncDocumentAddresses` and `syncDocumentTags` helpers
5. Create `PUT /api/sales/orders/:id/save` route
6. Add OpenAPI spec for the new endpoint
7. Integration tests

### Phase 3: Sales Quote Graph Save

1. Add `quoteGraphSaveSchema` to `data/validators.ts`
2. Implement `sales.quotes.save` command (mirrors order save)
3. Create `PUT /api/sales/quotes/:id/save` route
4. Integration tests

### Phase 4: Compound Command (Shipment + Adjustment)

1. Register `sales.shipments.create-with-cost` via `createCompoundCommand`
2. Update shipment route to dispatch compound command when `addShippingAdjustment` is true
3. Test compound undo (reverses both in order)

### Phase 5: Customer Graph Save

1. Add `personGraphSaveSchema` and `companyGraphSaveSchema`
2. Implement `customers.people.save` and `customers.companies.save`
3. Create new API routes
4. Integration tests

### Phase 6: Frontend Migration

1. Update order form to submit via `PUT /api/sales/orders/:id/save` instead of individual calls
2. Update quote form similarly
3. Update customer form similarly
4. Keep existing individual endpoints working for inline editing and integrations
5. Update undo UI to handle compound undo tokens

### Phase 7: Cleanup (optional, after frontend migration)

1. Remove the full-graph snapshot logic from individual line/adjustment commands
2. Individual commands (`lines.upsert`, `adjustments.upsert`) switch to lightweight snapshots (just the affected line + order totals) instead of the full graph
3. This reduces `loadOrderSnapshot` calls from 14 to ~3 (create, save, delete)
4. `documents.ts` shrinks significantly

## File Layout

```
packages/shared/src/lib/commands/
├── graph-save.ts           # mergeChildChanges helper (NEW)
├── compound.ts             # createCompoundCommand factory (NEW)
├── flush.ts                # withAtomicFlush (from SPEC-018)
├── command-bus.ts           # skipLog option added
├── types.ts                # CompoundStepResult, CompoundUndoPayload added
├── undo.ts                 # existing
├── helpers.ts              # existing
├── customFieldSnapshots.ts # existing
├── index.ts                # re-exports updated
└── __tests__/
    ├── graph-save.test.ts  # (NEW)
    └── compound.test.ts    # (NEW)

packages/core/src/modules/sales/
├── commands/
│   └── documents.ts        # + orderSaveCommand, quoteSaveCommand
├── api/
│   ├── orders/
│   │   ├── route.ts        # existing (header-only update)
│   │   └── save/
│   │       └── route.ts    # NEW (graph save)
│   └── quotes/
│       ├── route.ts        # existing
│       └── save/
│           └── route.ts    # NEW (graph save)
├── data/
│   └── validators.ts       # + orderGraphSaveSchema, quoteGraphSaveSchema
└── lib/
    └── document-helpers.ts  # + syncDocumentAddresses, syncDocumentTags

packages/core/src/modules/customers/
├── commands/
│   └── people.ts           # + personSaveCommand
│   └── companies.ts        # + companySaveCommand
├── api/
│   ├── people/
│   │   └── save/
│   │       └── route.ts    # NEW
│   └── companies/
│       └── save/
│           └── route.ts    # NEW
└── data/
    └── validators.ts       # + personGraphSaveSchema, companyGraphSaveSchema
```

## Testing Strategy

### Unit Tests

#### `mergeChildChanges`

```typescript
describe('mergeChildChanges', () => {
  it('returns existing when no changes', () => { ... })
  it('removes deleted items', () => { ... })
  it('updates existing items via upsert with id', () => { ... })
  it('appends new items via upsert without id', () => { ... })
  it('handles combined upsert + delete', () => { ... })
  it('handles empty existing array', () => { ... })
  it('ignores delete IDs that dont exist', () => { ... })
})
```

#### `executeCompound`

```typescript
describe('executeCompound', () => {
  it('executes steps in order', () => { ... })
  it('writes single compound audit log', () => { ... })
  it('rolls back all steps on failure in transaction mode', () => { ... })
  it('undo reverses steps in reverse order', () => { ... })
  it('skips individual audit logs for sub-commands', () => { ... })
})
```

### Integration Tests

#### Order Graph Save

```typescript
describe('sales.orders.save', () => {
  it('updates header + adds lines + removes lines in one operation', () => { ... })
  it('recalculates totals once on final state', () => { ... })
  it('produces single audit log entry', () => { ... })
  it('undo restores entire graph to previous state', () => { ... })
  it('handles custom fields on order and lines', () => { ... })
  it('syncs addresses and tags', () => { ... })
  it('works with empty changes (no-op)', () => { ... })
  it('validates all line schemas before executing', () => { ... })
  it('rolls back on calculation error', () => { ... })
})
```

## Alternatives Considered

### A. Replace Individual Commands with Graph Save Only

Remove `lines.upsert`, `lines.delete`, etc. entirely. All line changes go through graph save.

**Rejected**: Inline editing in data tables requires per-line granularity. Integrations depend on per-line endpoints. Forcing the entire graph for a single cell edit is wasteful.

### B. Batch Endpoint (Array of Operations)

A generic `POST /api/sales/orders/:id/batch` that accepts `[{ op: 'upsert-line', ... }, { op: 'delete-line', ... }]`.

**Rejected**: Loses type safety (each operation has different schemas). The graph-save schema is more explicit and validates the entire payload at once. A batch endpoint is harder to document in OpenAPI.

### C. Event Sourcing

Store each change as an event, rebuild state from events. Undo = append a compensating event.

**Rejected**: Massive architectural change. The snapshot-based undo pattern is well-established and works. Event sourcing adds complexity (projections, snapshots, replay) without proportional benefit for this use case.

### D. Compound via Middleware (Transaction Wrapper Around Multiple HTTP Calls)

Frontend sends multiple HTTP calls, middleware wraps them in a transaction.

**Rejected**: HTTP is stateless — wrapping multiple requests in a DB transaction requires session affinity and connection pinning. Fragile, complex, and doesn't solve the N-recalculations problem.

### E. Deferred Calculation in Compound

Run sub-commands without recalculation, then recalculate once at the end.

**Rejected**: Sub-commands produce invalid intermediate states (wrong totals). Other subscribers or hooks that depend on consistent totals would see wrong data. The graph-save approach calculates on the final state directly — no invalid intermediate.

## Success Metrics

- **Snapshot reduction**: `loadOrderSnapshot` calls drop from 14 to ~3 per order lifecycle
- **Recalculation reduction**: Form save with N changes recalculates once instead of N times
- **Undo UX**: User clicks undo once to revert a form save (instead of N times)
- **Audit log clarity**: One entry per user action (instead of N entries)
- **`documents.ts` size**: Target reduction from ~5,900 to ~4,000 lines after Phase 7 cleanup
- **API response time**: Order save with 10 line changes should be faster than 10 sequential line upserts

## Open Questions

1. **Partial failure semantics**: If the graph-save schema validates but one line has invalid data (e.g., negative quantity), should the entire save fail or should valid changes apply? **Proposed**: Entire save fails (transaction rollback). The frontend should validate before submitting.

2. **Optimistic concurrency**: Should the graph-save command check for concurrent modifications (e.g., `updatedAt` mismatch)? Not in scope for this spec — can be added later via `If-Match` header or `version` field.

3. **Max payload size**: Should we limit the number of lines/adjustments in a single graph-save call? **Proposed**: Same limits as existing CRUD (pageSize 100). For bulk imports beyond 100 lines, use a queue job.

4. **Frontend rollout**: Should the frontend switch to graph-save immediately, or use feature flags? **Proposed**: Feature flag (`USE_GRAPH_SAVE`) during transition, defaulting to `true` for new installs.

## Changelog

### 2026-02-07
- Initial specification
- Defined Graph Save pattern (Pattern A) for calculation-coupled children
- Defined Compound Command factory `createCompoundCommand` (Pattern B) for independent commands
- Full `createCompoundCommand` API with `buildSteps`, runtime flow diagram, and concrete shipment example
- Full analysis of current command patterns and coupling
- Integration with SPEC-018 (withAtomicFlush)
- Migration path in 7 phases
