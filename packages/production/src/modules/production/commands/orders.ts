import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import {
  ProductionOrder,
  ProductionOrderOperation,
  ProductionOrderMaterial,
  ProductionBom,
  ProductionBomItem,
  Routing,
  RoutingOperation,
} from '../data/entities.js'
import type { OrderCreateInput, OrderUpdateInput } from '../data/validators.js'
import { assertOrderTransition, canCancelFromStatus, IllegalOrderTransitionError } from '../lib/orderStatusMachine.js'
import {
  InsufficientStockError,
  StockUomMismatchError,
  type ProductionStockProvider,
  type StockMovementRef,
} from '../lib/stockProvider.js'
import { loadStockItemsByProduct, findStockItemFor, type ShortageLine } from '../lib/materialShortages.js'
import { emitProductionEvent } from '../events.js'
import { enforceProductionOrderOptimisticLock } from './shared.js'
import { E } from '../../../../generated/entities.ids.generated.js'

/**
 * Production order commands (spec § Status machine / Data Models, Phase 3).
 *
 * `release` is the only command that mutates more than the order header: it
 * copies the currently-ACTIVE `ProductionBomItem`/`RoutingOperation` rows for
 * the order's product/variant into `ProductionOrderMaterial`/
 * `ProductionOrderOperation` as independent snapshot rows (decision g) inside
 * one `withAtomicFlush` transaction alongside the order's own status/version
 * fields — so a later edit to the source technology (even a whole new active
 * BOM/routing version) can never retroactively change an already-released
 * order.
 *
 * Undo: state-machine transitions are not naturally reversible (a "release
 * undo" would have to un-copy snapshot rows a report may already reference,
 * and a "cancel undo" would have to re-create reservations that may no
 * longer be satisfiable) so every command below is `isUndoable: false` —
 * mirrors the reasoning in `commands/stock.ts` for the append-only ledger.
 */

function requireScopeIds(ctx: CommandRuntimeContext): { tenantId: string; organizationId: string } {
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: '[internal] Missing tenant/organization scope' })
  }
  return { tenantId, organizationId }
}

function resolveDataEngine(ctx: CommandRuntimeContext): DataEngine {
  return ctx.container.resolve<DataEngine>('dataEngine')
}

function resolveStockProvider(ctx: CommandRuntimeContext): ProductionStockProvider {
  return ctx.container.resolve<ProductionStockProvider>('productionStockProvider')
}

const orderCrudIndexer: CrudIndexerConfig<ProductionOrder> = { entityType: E.production.production_order }
const orderCrudEvents: CrudEventsConfig<ProductionOrder> = { module: 'production', entity: 'order', persistent: true }

/**
 * Maps an {@link IllegalOrderTransitionError} to a translated, user-facing
 * `CrudHttpError(422, ...)` — never the raw `[internal]` `Error#message`
 * (matches the `mapStockProviderError` convention in `commands/stock.ts`).
 */
async function mapOrderTransitionError(err: unknown): Promise<unknown> {
  if (err instanceof IllegalOrderTransitionError) {
    const { translate } = await resolveTranslations()
    return new CrudHttpError(422, {
      error: translate(
        'production.errors.order_illegal_transition',
        'This production order cannot move from "{from}" to "{to}".',
        { from: err.from, to: err.to },
      ),
    })
  }
  return err
}

/**
 * Per-org sequence number for `ProductionOrder.number` (spec § Data Models —
 * `number` sequence per org). The sales module has a fully configurable
 * `salesDocumentNumberGenerator` (prefixes, reset periods, per-tenant format
 * settings); reusing it here is deliberately out of scope for this task — it
 * is a document-numbering *policy* concern, not part of the status-machine/
 * snapshot-immutability DoD this task closes. This is the same simple
 * "max + 1 inside the same transaction" approach `nextBomVersion`/
 * `nextRoutingVersion` already use in `commands/technology.ts`; the
 * `production_orders_scope_number_unique` constraint is the safety net
 * against a concurrent race producing a duplicate number.
 */
async function nextOrderNumber(em: EntityManager, scope: { tenantId: string; organizationId: string }): Promise<number> {
  const rows = await em.find(ProductionOrder, { tenantId: scope.tenantId, organizationId: scope.organizationId })
  return rows.reduce((max: number, row: ProductionOrder) => Math.max(max, row.number), 0) + 1
}

async function loadOrder(em: EntityManager, id: string): Promise<ProductionOrder> {
  const order = await em.findOne(ProductionOrder, { id, deletedAt: null })
  if (!order) throw new CrudHttpError(404, { error: '[internal] Production order not found' })
  return order
}

// ---------------------------------------------------------------------------
// production.orders.create
// ---------------------------------------------------------------------------

const createOrderCommand: CommandHandler<OrderCreateInput, { id: string }> = {
  id: 'production.orders.create',
  isUndoable: false,

  async execute(input, ctx) {
    const { tenantId, organizationId } = requireScopeIds(ctx)
    const em = ctx.container.resolve<EntityManager>('em').fork()

    const number = await nextOrderNumber(em, { tenantId, organizationId })

    const order = em.create(ProductionOrder, {
      tenantId,
      organizationId,
      number,
      productId: input.productId,
      variantId: input.variantId ?? null,
      qtyPlanned: String(input.qtyPlanned),
      uom: input.uom,
      dueDate: input.dueDate ?? null,
      priority: input.priority,
      status: 'draft',
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      bomVersionId: null,
      routingVersionId: null,
      releasedAt: null,
      qtyCompleted: '0',
      qtyScrapped: '0',
    } as never)

    try {
      await withAtomicFlush(em, [() => { em.persist(order) }], { transaction: true, label: 'production.orders.create' })
    } catch (err) {
      // The per-org sequence number is derived by reading the max existing
      // number inside `nextOrderNumber` — a TOCTOU race lets two concurrent
      // creates both read the same max and try to persist the same number.
      // `production_orders_scope_number_unique` is the actual guard; surface
      // its violation as a translated, retryable 409 rather than a raw
      // `[internal]` DB exception (same pattern as `mapStockProviderError`'s
      // `DoubleReversalError` translation in `commands/stock.ts`).
      if (err instanceof UniqueConstraintViolationException) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(409, {
          error: translate(
            'production.errors.order_number_conflict',
            'Another production order was just created with this number. Please try again.',
          ),
        })
      }
      throw err
    }

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'created',
      entity: order,
      identifiers: { id: order.id, organizationId, tenantId },
      indexer: orderCrudIndexer,
      events: orderCrudEvents,
    })

    return { id: order.id }
  },

  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('production.audit.order.create', 'Create production order'),
      resourceKind: 'production.order',
      resourceId: result.id,
      payload: { input },
    }
  },
}

// ---------------------------------------------------------------------------
// production.orders.update — header fields only, draft|planned only
// ---------------------------------------------------------------------------

const updateOrderCommand: CommandHandler<OrderUpdateInput, { ok: boolean }> = {
  id: 'production.orders.update',
  isUndoable: false,

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const order = await loadOrder(em, input.id)

    ensureTenantScope(ctx, order.tenantId)
    ensureOrganizationScope(ctx, order.organizationId)
    await enforceProductionOrderOptimisticLock(ctx, order)

    if (order.status !== 'draft' && order.status !== 'planned') {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(422, {
        error: translate(
          'production.errors.order_not_editable',
          'This production order can no longer be edited once released.',
        ),
      })
    }

    await withAtomicFlush(
      em,
      [
        () => {
          if (input.qtyPlanned !== undefined) order.qtyPlanned = String(input.qtyPlanned)
          if (input.uom !== undefined) order.uom = input.uom
          if (input.dueDate !== undefined) order.dueDate = input.dueDate
          if (input.priority !== undefined) order.priority = input.priority
          order.updatedAt = new Date()
        },
      ],
      { transaction: true, label: 'production.orders.update' },
    )

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'updated',
      entity: order,
      identifiers: { id: order.id, organizationId: order.organizationId, tenantId: order.tenantId },
      indexer: orderCrudIndexer,
      events: orderCrudEvents,
    })

    return { ok: true }
  },

  async buildLog({ input }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('production.audit.order.update', 'Update production order'),
      resourceKind: 'production.order',
      resourceId: input.id,
      payload: { input },
    }
  },
}

// ---------------------------------------------------------------------------
// production.orders.delete — draft only
// ---------------------------------------------------------------------------

const deleteOrderCommand: CommandHandler<{ id: string }, { ok: boolean }> = {
  id: 'production.orders.delete',
  isUndoable: false,

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const order = await loadOrder(em, input.id)

    ensureTenantScope(ctx, order.tenantId)
    ensureOrganizationScope(ctx, order.organizationId)
    await enforceProductionOrderOptimisticLock(ctx, order)

    if (order.status !== 'draft') {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(422, {
        error: translate('production.errors.order_delete_not_draft', 'Only draft production orders can be deleted.'),
      })
    }

    await withAtomicFlush(
      em,
      [
        () => {
          order.deletedAt = new Date()
          order.updatedAt = new Date()
        },
      ],
      { transaction: true, label: 'production.orders.delete' },
    )

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'deleted',
      entity: order,
      identifiers: { id: order.id, organizationId: order.organizationId, tenantId: order.tenantId },
      indexer: orderCrudIndexer,
      events: orderCrudEvents,
    })

    return { ok: true }
  },

  async buildLog({ input }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('production.audit.order.delete', 'Delete production order'),
      resourceKind: 'production.order',
      resourceId: input.id,
    }
  },
}

// ---------------------------------------------------------------------------
// production.orders.plan — draft -> planned
// ---------------------------------------------------------------------------

const planOrderCommand: CommandHandler<{ id: string }, { ok: boolean }> = {
  id: 'production.orders.plan',
  isUndoable: false,

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const order = await loadOrder(em, input.id)

    ensureTenantScope(ctx, order.tenantId)
    ensureOrganizationScope(ctx, order.organizationId)
    await enforceProductionOrderOptimisticLock(ctx, order)

    try {
      assertOrderTransition(order.status, 'planned')
    } catch (err) {
      throw await mapOrderTransitionError(err)
    }

    await withAtomicFlush(
      em,
      [
        () => {
          order.status = 'planned'
          order.updatedAt = new Date()
        },
      ],
      { transaction: true, label: 'production.orders.plan' },
    )

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'updated',
      entity: order,
      identifiers: { id: order.id, organizationId: order.organizationId, tenantId: order.tenantId },
      indexer: orderCrudIndexer,
      events: orderCrudEvents,
    })

    return { ok: true }
  },

  async buildLog({ input }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('production.audit.order.plan', 'Plan production order'),
      resourceKind: 'production.order',
      resourceId: input.id,
    }
  },
}

// ---------------------------------------------------------------------------
// production.orders.release — planned -> released, snapshot copy (decision g)
// ---------------------------------------------------------------------------

/**
 * Reservation seam (spec § Status machine: "release ... emits reservations +
 * shortage list"). Wires the freshly-copied `ProductionOrderMaterial` rows
 * to `productionStockProvider.reserve`, one line per material.
 *
 * Decision (task 3.2 brief): release NEVER blocks on a shortage. For every
 * material line this reserves whatever is currently free on-hand (a partial
 * reservation when on-hand can't cover the full requirement) and reports the
 * unmet remainder as a {@link ShortageLine} — this mirrors the netting a
 * later MRP run will perform, rather than treating a shortage as an error.
 * Reads are batched by product id (one `StockItem` query for every material
 * line on the order) to avoid an N+1 lookup per line.
 */
async function reserveMaterialsForOrder(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  order: ProductionOrder,
  materials: ProductionOrderMaterial[],
): Promise<{ reservations: number; shortages: ShortageLine[] }> {
  const scope = { tenantId: order.tenantId, organizationId: order.organizationId }
  const stockProvider = resolveStockProvider(ctx)
  const ref: StockMovementRef = { scope, sourceType: 'order', sourceId: order.id }

  const productIds = [...new Set(materials.map((m) => m.componentProductId))]
  const stockItems = await loadStockItemsByProduct(em, scope, productIds)
  // Tracks stock this release pass has already committed to a reservation,
  // keyed by stock item id — so a second material line referencing the same
  // component correctly sees reduced (not stale) availability.
  const consumedByStockItem = new Map<string, number>()

  const shortages: ShortageLine[] = []
  let reservations = 0

  for (const material of materials) {
    const netNeeded = Math.max(0, Number(material.qtyRequired) - Number(material.qtyIssued))
    if (netNeeded <= 0) continue

    const variantId = material.componentVariantId ?? null
    const stockItem = findStockItemFor(stockItems, material.componentProductId, variantId)

    if (!stockItem) {
      shortages.push({
        componentProductId: material.componentProductId,
        variantId,
        qtyRequired: netNeeded,
        qtyAvailable: 0,
        qtyShort: netNeeded,
        uom: material.uom,
        reason: 'no_stock_item',
      })
      continue
    }
    if (stockItem.uom !== material.uom) {
      shortages.push({
        componentProductId: material.componentProductId,
        variantId,
        qtyRequired: netNeeded,
        qtyAvailable: 0,
        qtyShort: netNeeded,
        uom: material.uom,
        reason: 'uom_mismatch',
      })
      continue
    }

    const alreadyConsumed = consumedByStockItem.get(stockItem.id) ?? 0
    const available = Math.max(0, Number(stockItem.onHand) - Number(stockItem.reserved) - alreadyConsumed)
    const qtyToReserve = Math.min(netNeeded, available)

    let actuallyReserved = 0
    let raceReason: ShortageLine['reason'] | null = null
    if (qtyToReserve > 0) {
      // Review finding: the pre-check above reads a snapshot of `stockItem`
      // taken before this loop started, so a concurrent release/reservation
      // against the SAME stock item between that read and this call can make
      // the provider's own fresh availability check fail even though
      // `qtyToReserve <= available` held here. Release must never fail (or
      // leave the just-committed status transition without its side effects
      // and event) because of this race — reclassify any provider domain
      // error into a shortage line instead of letting it propagate.
      try {
        await stockProvider.reserve(
          [{ productId: material.componentProductId, variantId, qty: qtyToReserve, uom: material.uom }],
          ref,
        )
        actuallyReserved = qtyToReserve
        reservations += 1
        consumedByStockItem.set(stockItem.id, alreadyConsumed + qtyToReserve)
      } catch (err) {
        if (err instanceof InsufficientStockError) raceReason = 'insufficient_stock'
        else if (err instanceof StockUomMismatchError) raceReason = 'uom_mismatch'
        else throw err
        // actuallyReserved stays 0 — the whole netNeeded amount is reported
        // as short below, since the reservation attempt failed entirely.
      }
    }

    if (actuallyReserved < netNeeded) {
      shortages.push({
        componentProductId: material.componentProductId,
        variantId,
        qtyRequired: netNeeded,
        qtyAvailable: raceReason ? 0 : available,
        qtyShort: netNeeded - actuallyReserved,
        uom: material.uom,
        reason: raceReason ?? 'insufficient_stock',
      })
    }
  }

  return { reservations, shortages }
}

const releaseOrderCommand: CommandHandler<{ id: string }, { ok: boolean; reservations: number; shortages: ShortageLine[] }> = {
  id: 'production.orders.release',
  isUndoable: false,

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const order = await loadOrder(em, input.id)

    ensureTenantScope(ctx, order.tenantId)
    ensureOrganizationScope(ctx, order.organizationId)
    await enforceProductionOrderOptimisticLock(ctx, order)

    try {
      assertOrderTransition(order.status, 'released')
    } catch (err) {
      throw await mapOrderTransitionError(err)
    }

    const bom = await em.findOne(ProductionBom, {
      tenantId: order.tenantId,
      organizationId: order.organizationId,
      productId: order.productId,
      variantId: order.variantId ?? null,
      status: 'active',
      deletedAt: null,
    })
    if (!bom) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(422, {
        error: translate(
          'production.errors.order_no_active_bom',
          'This product has no active bill of materials version to release against.',
        ),
      })
    }

    const routing = await em.findOne(Routing, {
      tenantId: order.tenantId,
      organizationId: order.organizationId,
      productId: order.productId,
      variantId: order.variantId ?? null,
      status: 'active',
      deletedAt: null,
    })
    if (!routing) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(422, {
        error: translate(
          'production.errors.order_no_active_routing',
          'This product has no active routing version to release against.',
        ),
      })
    }

    const bomItems = await em.find(ProductionBomItem, { bomId: bom.id, deletedAt: null })
    const routingOperations = await em.find(RoutingOperation, { routingId: routing.id, deletedAt: null })

    const createdMaterials: ProductionOrderMaterial[] = []
    const createdOperations: ProductionOrderOperation[] = []

    await withAtomicFlush(
      em,
      [
        () => {
          for (const op of routingOperations) {
            const created = em.create(ProductionOrderOperation, {
              tenantId: order.tenantId,
              organizationId: order.organizationId,
              orderId: order.id,
              sequence: op.sequence,
              name: op.name,
              workCenterId: op.workCenterId,
              setupTimeMinutes: op.setupTimeMinutes,
              runTimePerUnitSeconds: op.runTimePerUnitSeconds,
              isReportingPoint: op.isReportingPoint,
              status: 'pending',
              qtyGood: '0',
              qtyScrap: '0',
              sourceOperationId: op.id,
            } as never)
            createdOperations.push(created)
          }
          for (const item of bomItems) {
            const created = em.create(ProductionOrderMaterial, {
              tenantId: order.tenantId,
              organizationId: order.organizationId,
              orderId: order.id,
              operationSequence: item.operationSequence ?? null,
              componentProductId: item.componentProductId,
              componentVariantId: item.componentVariantId ?? null,
              qtyRequired: item.qtyPerUnit,
              uom: item.uom,
              scrapFactor: item.scrapFactor,
              qtyIssued: '0',
              sourceBomItemId: item.id,
            } as never)
            createdMaterials.push(created)
          }
          order.status = 'released'
          order.bomVersionId = bom.id
          order.routingVersionId = routing.id
          order.releasedAt = new Date()
          order.updatedAt = new Date()
        },
      ],
      { transaction: true, label: 'production.orders.release' },
    )

    const { reservations, shortages } = await reserveMaterialsForOrder(ctx, em, order, createdMaterials)

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'updated',
      entity: order,
      identifiers: { id: order.id, organizationId: order.organizationId, tenantId: order.tenantId },
      indexer: orderCrudIndexer,
    })
    await emitProductionEvent('production.order.released', {
      id: order.id,
      tenantId: order.tenantId,
      organizationId: order.organizationId,
    })

    return { ok: true, reservations, shortages }
  },

  async buildLog({ input }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('production.audit.order.release', 'Release production order'),
      resourceKind: 'production.order',
      resourceId: input.id,
    }
  },
}

// ---------------------------------------------------------------------------
// production.orders.cancel — draft|planned|released -> cancelled
// ---------------------------------------------------------------------------

const cancelOrderCommand: CommandHandler<{ id: string }, { ok: boolean }> = {
  id: 'production.orders.cancel',
  isUndoable: false,

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const order = await loadOrder(em, input.id)

    ensureTenantScope(ctx, order.tenantId)
    ensureOrganizationScope(ctx, order.organizationId)
    await enforceProductionOrderOptimisticLock(ctx, order)

    if (!canCancelFromStatus(order.status)) {
      throw await mapOrderTransitionError(new IllegalOrderTransitionError(order.status, 'cancelled'))
    }

    const materials = await em.find(ProductionOrderMaterial, { orderId: order.id, deletedAt: null })
    const hasPartialIssue = materials.some((m: ProductionOrderMaterial) => Number(m.qtyIssued) > 0)
    if (hasPartialIssue) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(409, {
        error: translate(
          'production.errors.order_cancel_blocked_partial_issue',
          'This order has material already issued — reverse (storno) the issue before cancelling.',
        ),
      })
    }

    // Load-bearing as of task 3.2: `reserveMaterialsForOrder` now actually
    // creates active `MaterialReservation` rows at release time (previously
    // a documented no-op seam, task 3.1), so this call releases real,
    // possibly-partial reservations rather than a guaranteed-empty set.
    const stockProvider = resolveStockProvider(ctx)
    const ref: StockMovementRef = {
      scope: { tenantId: order.tenantId, organizationId: order.organizationId },
      sourceType: 'order',
      sourceId: order.id,
    }
    await stockProvider.releaseReservations(ref)

    await withAtomicFlush(
      em,
      [
        () => {
          order.status = 'cancelled'
          order.updatedAt = new Date()
        },
      ],
      { transaction: true, label: 'production.orders.cancel' },
    )

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'updated',
      entity: order,
      identifiers: { id: order.id, organizationId: order.organizationId, tenantId: order.tenantId },
      indexer: orderCrudIndexer,
    })
    await emitProductionEvent('production.order.cancelled', {
      id: order.id,
      tenantId: order.tenantId,
      organizationId: order.organizationId,
    })

    return { ok: true }
  },

  async buildLog({ input }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('production.audit.order.cancel', 'Cancel production order'),
      resourceKind: 'production.order',
      resourceId: input.id,
    }
  },
}

// ---------------------------------------------------------------------------
// production.orders.close — completed -> closed (terminal bookkeeping)
// ---------------------------------------------------------------------------

const closeOrderCommand: CommandHandler<{ id: string }, { ok: boolean }> = {
  id: 'production.orders.close',
  isUndoable: false,

  async execute(input, ctx) {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const order = await loadOrder(em, input.id)

    ensureTenantScope(ctx, order.tenantId)
    ensureOrganizationScope(ctx, order.organizationId)
    await enforceProductionOrderOptimisticLock(ctx, order)

    try {
      assertOrderTransition(order.status, 'closed')
    } catch (err) {
      throw await mapOrderTransitionError(err)
    }

    await withAtomicFlush(
      em,
      [
        () => {
          order.status = 'closed'
          order.updatedAt = new Date()
        },
      ],
      { transaction: true, label: 'production.orders.close' },
    )

    await emitCrudSideEffects({
      dataEngine: resolveDataEngine(ctx),
      action: 'updated',
      entity: order,
      identifiers: { id: order.id, organizationId: order.organizationId, tenantId: order.tenantId },
      indexer: orderCrudIndexer,
      events: orderCrudEvents,
    })

    return { ok: true }
  },

  async buildLog({ input }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('production.audit.order.close', 'Close production order'),
      resourceKind: 'production.order',
      resourceId: input.id,
    }
  },
}

// ---------------------------------------------------------------------------
// Phase 4 hooks — status-transition guard SHAPE only (spec § Status machine:
// "completed requires a final report on the last reporting-point operation").
// The Phase 4 report command will call these after it validates the report
// itself; these functions only own the illegal-transition guard + status/
// timestamp mutation, not the report validation.
// ---------------------------------------------------------------------------

export function transitionOrderToInProgress(order: ProductionOrder): void {
  assertOrderTransition(order.status, 'in_progress')
  order.status = 'in_progress'
  order.updatedAt = new Date()
}

export function transitionOrderToCompleted(order: ProductionOrder): void {
  assertOrderTransition(order.status, 'completed')
  order.status = 'completed'
  order.updatedAt = new Date()
}

registerCommand(createOrderCommand)
registerCommand(updateOrderCommand)
registerCommand(deleteOrderCommand)
registerCommand(planOrderCommand)
registerCommand(releaseOrderCommand)
registerCommand(cancelOrderCommand)
registerCommand(closeOrderCommand)
